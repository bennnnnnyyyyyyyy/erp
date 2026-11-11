import type { Bindings } from '../env';
import { aiCapUsd, aiCompanyCapUsd } from './ai';
import {
  type AiDeps,
  type Audio,
  chatCostMicro,
  chatOllama,
  chatOpenAI,
  ELEVENLABS_STT_MICRO_PER_SECOND,
  estimateSeconds,
  OPENAI_STT_MICRO_PER_SECOND,
  realAiDeps,
  transcribeElevenLabs,
  transcribeOpenAI,
} from './aiProviders';
import { adminDb } from './db.admin';
import { HttpError } from './errors';

// Chooses the provider, keeps to the consent and the monthly caps, makes the call and logs it (sql/056, sql/060). The caller has
// already been signed in and its company resolved by the tenant middleware; this file is on the secret-key allowlist because it
// reads the company's saved AI keys and writes the usage log, both service-role only. It never reads company data and never changes
// anything: the answer is text for a person to read.
//
// Order of choice: chat uses the company's own Ollama if it is on, else OpenAI; speech to text uses ElevenLabs if on, else OpenAI.
// No provider, Ollama included, is used without the owner's acceptance of the current AI notice (sql/061: the database state hides
// them otherwise; Ollama sends data to an internet host the company typed, so it is an outside provider too).
// A company's own key is not capped by us. Our key is capped: USD 100 a month across companies (AI_MONTHLY_CAP_USD) and a share for
// each company (AI_COMPANY_CAP_USD, default 25) so one company cannot use it all. Cost figures are estimates, rounded up.
// The cap is SOFT (repo audit N11): spend is checked before a call and recorded after it, so every request in flight at that moment can
// pass the check, and the overrun grows with how many there are (each is limited to 800 output tokens or 5 MB of audio). Speech cost is
// an estimate from file size, so low-bitrate recordings are under-counted. A real hard stop needs a monthly spending limit on our OpenAI
// and ElevenLabs accounts: none is set yet (no keys on live, 9 Nov 2026); set one before adding our keys.

export type AiCaller = { orgId: string; userId: string };
export type AiAnswer = { text: string; provider: 'openai' | 'ollama' | 'elevenlabs'; ownKey: boolean };

// sql/082: no test mode; the state's 'simulated' flag is always false once 082 is applied and is not read here.
type ProviderState = { enabled: boolean; credentials: Record<string, string> };
type State = { consent: boolean; providers: { openai: ProviderState; elevenlabs: ProviderState; ollama: ProviderState } };

async function state(env: Bindings, orgId: string): Promise<State> {
  const { data, error } = await adminDb(env).rpc('ai__provider_state', { p_org: orgId });
  if (error) throw new Error('Could not read the AI settings');
  return data as State;
}

async function spend(env: Bindings, orgId: string | null): Promise<number> {
  const { data, error } = await adminDb(env).rpc('ai__month_spend', { p_org: orgId });
  if (error) throw new Error('Could not read the AI spending');
  return Number(data ?? 0);
}

async function record(
  env: Bindings,
  who: AiCaller,
  p: {
    provider: AiAnswer['provider'];
    feature: string;
    model: string | null;
    inTok?: number;
    outTok?: number;
    seconds?: number;
    cost: number;
    ownKey: boolean;
    ok: boolean;
  },
) {
  const args = {
    p_org: who.orgId,
    p_user: who.userId,
    p_provider: p.provider,
    p_feature: p.feature,
    p_model: p.model,
    p_in: p.inTok ?? 0,
    p_out: p.outTok ?? 0,
    p_seconds: p.seconds ?? 0,
    p_cost_micro: p.cost,
    p_own_key: p.ownKey,
    p_ok: p.ok,
  };
  // An unrecorded call is spend the cap never sees (repo audit 2026-11-06, N11), so try once more before giving up. A retry can only
  // double-count (the log is append-only), which errs on the safe side of the cap.
  let { error } = await adminDb(env).rpc('ai__record_usage', args);
  if (error) ({ error } = await adminDb(env).rpc('ai__record_usage', args));
  if (error) console.error('AI USAGE NOT RECORDED (cap will under-count)', p.provider, p.cost, error.message);
}

/** Refuse a call on our key once the shared or the company's monthly allowance is used. */
async function checkCaps(env: Bindings, who: AiCaller) {
  if ((await spend(env, null)) >= aiCapUsd(env) * 1_000_000)
    throw new HttpError(
      429,
      'The shared AI allowance for this month is used up. Add your own key in Settings → Integrations, or use Ollama.',
      'ai_cap',
    );
  if ((await spend(env, who.orgId)) >= aiCompanyCapUsd(env) * 1_000_000)
    throw new HttpError(
      429,
      "This company's share of the shared AI allowance for this month is used up. Add your own key, or use Ollama.",
      'ai_company_cap',
    );
}

const off = () => new HttpError(409, 'AI is switched off. The owner can turn it on in Settings → Integrations.', 'ai_off');
const noKey = () => new HttpError(409, 'No AI key is available. Add your own key in Settings → Integrations.', 'ai_no_key');

export async function askAi(
  env: Bindings,
  who: AiCaller,
  feature: string,
  system: string,
  user: string,
  deps: AiDeps = realAiDeps,
): Promise<AiAnswer> {
  const s = await state(env, who.orgId);
  const { ollama, openai } = s.providers;

  if (ollama.enabled) {
    const model = ollama.credentials.model;
    try {
      const r = await chatOllama(
        { baseUrl: ollama.credentials.base_url ?? '', model: model ?? '', apiKey: ollama.credentials.api_key, system, user },
        deps,
      );
      await record(env, who, {
        provider: 'ollama',
        feature,
        model: model ?? null,
        inTok: r.inputTokens,
        outTok: r.outputTokens,
        cost: 0,
        ownKey: true,
        ok: true,
      });
      return { text: r.text, provider: 'ollama', ownKey: true };
    } catch (e) {
      await record(env, who, { provider: 'ollama', feature, model: model ?? null, cost: 0, ownKey: true, ok: false });
      throw new HttpError(502, e instanceof Error ? e.message : 'Your Ollama server could not be reached', 'provider_error');
    }
  }

  if (!openai.enabled) throw off();
  const own = openai.credentials.api_key;
  const apiKey = own || env.OPENAI_API_KEY;
  if (!apiKey) throw noKey();
  const ownKey = Boolean(own);
  // Our key always uses our model: a company's chosen model (which may cost far more) applies to its own key only.
  const model = ownKey ? openai.credentials.model || 'gpt-5-mini' : 'gpt-5-mini';
  if (!ownKey) await checkCaps(env, who);
  try {
    const r = await chatOpenAI({ apiKey, model, system, user }, deps);
    await record(env, who, {
      provider: 'openai',
      feature,
      model,
      inTok: r.inputTokens,
      outTok: r.outputTokens,
      cost: chatCostMicro(r.inputTokens, r.outputTokens),
      ownKey,
      ok: true,
    });
    return { text: r.text, provider: 'openai', ownKey };
  } catch (e) {
    await record(env, who, { provider: 'openai', feature, model, cost: 0, ownKey, ok: false });
    throw new HttpError(502, e instanceof Error ? e.message : 'OpenAI could not be reached', 'provider_error');
  }
}

export async function transcribeAudio(
  env: Bindings,
  who: AiCaller,
  audio: Audio,
  language: string | undefined,
  deps: AiDeps = realAiDeps,
): Promise<AiAnswer> {
  const s = await state(env, who.orgId);
  const { elevenlabs, openai } = s.providers;
  const useEleven = elevenlabs.enabled;
  const chosen = useEleven ? elevenlabs : openai;
  if (!chosen.enabled) throw off();
  const provider = useEleven ? 'elevenlabs' : 'openai';
  const seconds = estimateSeconds(audio.bytes.byteLength);
  const own = chosen.credentials.api_key;
  const apiKey = own || (useEleven ? env.ELEVENLABS_API_KEY : env.OPENAI_API_KEY);
  if (!apiKey) throw noKey();
  const ownKey = Boolean(own);
  const cost = Math.ceil(seconds * (useEleven ? ELEVENLABS_STT_MICRO_PER_SECOND : OPENAI_STT_MICRO_PER_SECOND));
  if (!ownKey) await checkCaps(env, who);
  try {
    const r = useEleven
      ? await transcribeElevenLabs({ apiKey, audio, language }, deps)
      : await transcribeOpenAI({ apiKey, audio, language }, deps);
    await record(env, who, { provider, feature: 'transcribe', model: null, seconds, cost, ownKey, ok: true });
    return { text: r.text, provider, ownKey };
  } catch (e) {
    await record(env, who, { provider, feature: 'transcribe', model: null, seconds, cost: 0, ownKey, ok: false });
    throw new HttpError(502, e instanceof Error ? e.message : 'The speech provider could not be reached', 'provider_error');
  }
}

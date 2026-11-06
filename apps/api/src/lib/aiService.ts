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
// OpenAI and ElevenLabs are never used without the owner's consent (the database state already hides them if it was withdrawn).
// A company's own key is not capped by us. Our key is capped: USD 100 a month across companies (AI_MONTHLY_CAP_USD) and a share for
// each company (AI_COMPANY_CAP_USD, default 25) so one company cannot use it all. Cost figures are estimates, rounded up.

export type AiCaller = { orgId: string; userId: string };
export type AiAnswer = { text: string; provider: 'openai' | 'ollama' | 'elevenlabs' | 'simulated'; simulated: boolean; ownKey: boolean };

type ProviderState = { enabled: boolean; simulated: boolean; credentials: Record<string, string> };
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
  const { error } = await adminDb(env).rpc('ai__record_usage', {
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
  });
  if (error) console.error('ai usage not recorded', error.message);
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
    if (ollama.simulated) {
      await record(env, who, { provider: 'simulated', feature, model: null, cost: 0, ownKey: true, ok: true });
      return {
        text: '[Simulated AI] This is a test answer from your own AI. Nothing was sent anywhere.',
        provider: 'simulated',
        simulated: true,
        ownKey: true,
      };
    }
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
      return { text: r.text, provider: 'ollama', simulated: false, ownKey: true };
    } catch (e) {
      await record(env, who, { provider: 'ollama', feature, model: model ?? null, cost: 0, ownKey: true, ok: false });
      throw new HttpError(502, e instanceof Error ? e.message : 'Your Ollama server could not be reached', 'provider_error');
    }
  }

  if (!openai.enabled) throw off();
  if (openai.simulated) {
    await record(env, who, { provider: 'simulated', feature, model: null, cost: 0, ownKey: true, ok: true });
    return {
      text: '[Simulated AI] This is a test answer. Nothing was sent to OpenAI.',
      provider: 'simulated',
      simulated: true,
      ownKey: false,
    };
  }
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
    return { text: r.text, provider: 'openai', simulated: false, ownKey };
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
  if (chosen.simulated) {
    await record(env, who, { provider: 'simulated', feature: 'transcribe', model: null, seconds, cost: 0, ownKey: true, ok: true });
    return {
      text: '[Simulated transcript] This is a test transcript. Nothing was sent to a provider.',
      provider: 'simulated',
      simulated: true,
      ownKey: false,
    };
  }
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
    return { text: r.text, provider, simulated: false, ownKey };
  } catch (e) {
    await record(env, who, { provider, feature: 'transcribe', model: null, seconds, cost: 0, ownKey, ok: false });
    throw new HttpError(502, e instanceof Error ? e.message : 'The speech provider could not be reached', 'provider_error');
  }
}

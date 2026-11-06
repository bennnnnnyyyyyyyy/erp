// AI and voice providers (sql/056, sql/060): OpenAI, Ollama (the company's own AI) and ElevenLabs. Pure request code with an injected
// fetch so tests send nothing. Nothing here reads the database or decides who may call: lib/aiService.ts does that.
// Request shapes follow the vendors' public API pages; the exact fields are checked against a real call when keys arrive.

export type AiDeps = { fetch: typeof fetch };
export const realAiDeps: AiDeps = { fetch: (...a) => fetch(...a) };

export type ChatResult = { text: string; inputTokens: number; outputTokens: number };
export type TranscribeResult = { text: string };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0);

async function json(res: Response): Promise<Obj> {
  try {
    const j = await res.json();
    return isObj(j) ? j : {};
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------ cost estimates (micro-USD; rounded up, so the cap errs on the safe side)

/** OpenAI gpt-5-mini list prices at the time of writing: USD 0.25 in and 2.00 out per million tokens. Estimates, not invoices. */
export const OPENAI_MICRO_PER_INPUT_TOKEN = 0.25;
export const OPENAI_MICRO_PER_OUTPUT_TOKEN = 2;
/** Speech to text: OpenAI whisper about USD 0.006 a minute; ElevenLabs about USD 0.40 an hour. */
export const OPENAI_STT_MICRO_PER_SECOND = 100;
export const ELEVENLABS_STT_MICRO_PER_SECOND = 112;

export const chatCostMicro = (inTok: number, outTok: number) =>
  Math.ceil(inTok * OPENAI_MICRO_PER_INPUT_TOKEN + outTok * OPENAI_MICRO_PER_OUTPUT_TOKEN);
/** Length of an upload is not trusted: assume a compressed recording of about 16 kB a second, at least one second. */
export const estimateSeconds = (bytes: number) => Math.max(1, Math.ceil(bytes / 16000));

// ------------------------------------------------------------------ Ollama address safety

/** The address is typed by a company, and our server will call it. Only a public https host name is allowed (no localhost, no IP numbers). */
export function assertSafeOllamaUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('The Ollama address is not a valid web address');
  }
  const host = u.hostname.toLowerCase();
  const ipLike = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[');
  if (u.protocol !== 'https:' || host === 'localhost' || ipLike || !host.includes('.') || /\.(local|internal|localhost|lan)$/.test(host)) {
    throw new Error('The Ollama address must be a public https host name (not localhost or an IP number)');
  }
  return u;
}

// ------------------------------------------------------------------ chat

export async function chatOpenAI(
  p: { apiKey: string; model: string; system: string; user: string },
  deps: AiDeps = realAiDeps,
): Promise<ChatResult> {
  const res = await deps.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: p.model,
      max_completion_tokens: 800,
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ],
    }),
  });
  const j = await json(res);
  const choices = Array.isArray(j.choices) ? j.choices : [];
  const first = isObj(choices[0]) ? choices[0] : {};
  const msg = isObj(first.message) ? first.message : {};
  const text = typeof msg.content === 'string' ? msg.content.trim() : '';
  if (!res.ok || !text) throw new Error(`OpenAI refused the request (${res.status})`);
  const usage = isObj(j.usage) ? j.usage : {};
  return { text, inputTokens: num(usage.prompt_tokens), outputTokens: num(usage.completion_tokens) };
}

export async function chatOllama(
  p: { baseUrl: string; model: string; apiKey?: string; system: string; user: string },
  deps: AiDeps = realAiDeps,
): Promise<ChatResult> {
  const base = assertSafeOllamaUrl(p.baseUrl);
  const res = await deps.fetch(new URL('/api/chat', base).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
    body: JSON.stringify({
      model: p.model,
      stream: false,
      messages: [
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ],
    }),
  });
  const j = await json(res);
  const msg = isObj(j.message) ? j.message : {};
  const text = typeof msg.content === 'string' ? msg.content.trim() : '';
  if (!res.ok || !text) throw new Error(`The Ollama server refused the request (${res.status})`);
  return { text, inputTokens: num(j.prompt_eval_count), outputTokens: num(j.eval_count) };
}

// ------------------------------------------------------------------ speech to text

export type Audio = { bytes: ArrayBuffer; name: string; type: string };

export async function transcribeOpenAI(
  p: { apiKey: string; audio: Audio; language?: string },
  deps: AiDeps = realAiDeps,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('file', new Blob([p.audio.bytes], { type: p.audio.type }), p.audio.name);
  form.append('model', 'whisper-1');
  if (p.language) form.append('language', p.language);
  const res = await deps.fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.apiKey}` },
    body: form,
  });
  const j = await json(res);
  if (!res.ok || typeof j.text !== 'string') throw new Error(`OpenAI refused the audio (${res.status})`);
  return { text: j.text.trim() };
}

export async function transcribeElevenLabs(
  p: { apiKey: string; audio: Audio; language?: string },
  deps: AiDeps = realAiDeps,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('file', new Blob([p.audio.bytes], { type: p.audio.type }), p.audio.name);
  form.append('model_id', 'scribe_v1');
  if (p.language) form.append('language_code', p.language);
  const res = await deps.fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': p.apiKey },
    body: form,
  });
  const j = await json(res);
  if (!res.ok || typeof j.text !== 'string') throw new Error(`ElevenLabs refused the audio (${res.status})`);
  return { text: j.text.trim() };
}

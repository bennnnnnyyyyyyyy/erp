// AI and voice providers (sql/056, sql/060): OpenAI, Ollama (the company's own AI) and ElevenLabs. Pure request code with an injected
// fetch so tests send nothing. Nothing here reads the database or decides who may call: lib/aiService.ts does that.
// Request shapes follow the vendors' public API pages; the exact fields are checked against a real call when keys arrive.

/** `sleep`: the wait between tries when a provider is busy (readDocument); tests pass one that does not wait. */
export type AiDeps = { fetch: typeof fetch; sleep?: (ms: number) => Promise<void> };
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
    // Never follow a redirect: it would bypass assertSafeOllamaUrl (repo audit 2026-11-06, N3). Ask for the final address instead.
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('Location');
    throw new Error(`The Ollama address redirects${to ? ` to ${to.slice(0, 200)}` : ''}. Save the final https address instead.`);
  }
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

// ------------------------------------------------------------------ reading a document (sql/108, scanning step 0)
// One door for the six providers that read a picture or a PDF and give back JSON in a fixed shape. Only the company's own key is used
// (lib/aiService.ts decides). Whatever comes back is only a suggestion: the caller checks its shape again and a person saves.

export type ReaderKind = 'openai' | 'gemini' | 'anthropic' | 'grok' | 'openrouter' | 'ollama';
export type DocFile = { bytes: ArrayBuffer; mime: string };
export type ReadRequest = {
  kind: ReaderKind;
  apiKey: string;
  model: string;
  /** Ollama only: the company's https address. */
  baseUrl?: string;
  file: DocFile;
  instructions: string;
  schemaName: string;
  schema: Obj;
  maxTokens?: number;
};
export type ReadResult = { data: unknown; inputTokens: number; outputTokens: number };

export const READER_NAMES: Record<ReaderKind, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Claude',
  grok: 'Grok',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
};
/** Used when the company saved no model. Grok, OpenRouter and Ollama have no default: their model is required. Gemini uses Google's
 *  "latest" name, which always points to its current Flash model (gemini-2.5-flash was no longer found for a free key, 24 Nov 2026). */
export const READER_DEFAULT_MODEL: Partial<Record<ReaderKind, string>> = {
  openai: 'gpt-5-mini',
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-haiku-5-5',
};
/** Which providers take a PDF as it is. The others read pictures only. */
export const READER_READS_PDF: Record<ReaderKind, boolean> = {
  openai: true,
  gemini: true,
  anthropic: true,
  openrouter: true,
  grok: false,
  ollama: false,
};
export const READER_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

const OPENAI_STYLE_URL: Record<'openai' | 'grok' | 'openrouter', string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  grok: 'https://api.x.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

export function toBase64(bytes: ArrayBuffer): string {
  const u = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The JSON object in a model's text answer (some wrap it in ``` fences or add words around it). */
export function jsonFromText(text: string): unknown {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The AI did not answer with data');
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    throw new Error('The AI answer was not complete data');
  }
}

/** A plain reason for a refusal. Never the provider's body: some providers repeat part of the key in it. */
function refused(name: string, status: number): Error {
  const why =
    status === 401 || status === 403
      ? 'the key was refused'
      : status === 404
        ? 'the model was not found: type another model on its card in Settings, Integrations, then Check connection'
        : status === 429
          ? 'too many requests, or no credit left on the account'
          : status === 413
            ? 'the file is too large for it'
            : BUSY.includes(status)
              ? 'it is busy right now; wait a minute and try again'
              : `answer ${status}`;
  return new Error(`${name} refused the request (${why})`);
}

/** "Busy, try again later" answers: overloaded or briefly down (Gemini's free tier answered 503, 24 Nov 2026; Claude uses 529). Not 429:
 *  that is the account's limit, and trying again at once only makes it worse. */
const BUSY = [500, 502, 503, 504, 529];
const BUSY_WAITS_MS = [1500, 4000];
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The same fetch, tried up to twice more while the provider answers "busy". A refused request is not charged. */
function retryingWhenBusy(deps: AiDeps): AiDeps {
  const sleep = deps.sleep ?? realSleep;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let res = await deps.fetch(input, init);
    for (const ms of BUSY_WAITS_MS) {
      if (!BUSY.includes(res.status)) break;
      await sleep(ms);
      res = await deps.fetch(input, init);
    }
    return res;
  }) as typeof fetch;
  return { ...deps, fetch: fetchFn };
}

const MODEL_RE = /^[A-Za-z0-9._:/@-]{1,120}$/;

export async function readDocument(p: ReadRequest, given: AiDeps = realAiDeps): Promise<ReadResult> {
  const deps = retryingWhenBusy(given);
  const name = READER_NAMES[p.kind];
  if (!MODEL_RE.test(p.model)) throw new Error(`The ${name} model name is not valid`);
  const isPdf = p.file.mime === 'application/pdf';
  if (isPdf && !READER_READS_PDF[p.kind]) throw new Error(`${name} cannot read PDF files`);
  const b64 = toBase64(p.file.bytes);
  const dataUrl = `data:${p.file.mime};base64,${b64}`;
  const maxTokens = p.maxTokens ?? 4000;

  if (p.kind === 'openai' || p.kind === 'grok' || p.kind === 'openrouter') {
    const filePart = isPdf
      ? { type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl } };
    const res = await deps.fetch(OPENAI_STYLE_URL[p.kind], {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        ...(p.kind === 'openai' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
        response_format: { type: 'json_schema', json_schema: { name: p.schemaName, strict: true, schema: p.schema } },
        messages: [{ role: 'user', content: [{ type: 'text', text: p.instructions }, filePart] }],
      }),
    });
    if (!res.ok) throw refused(name, res.status);
    const j = await json(res);
    const first = Array.isArray(j.choices) && isObj(j.choices[0]) ? j.choices[0] : {};
    const msg = isObj(first.message) ? first.message : {};
    const text = typeof msg.content === 'string' ? msg.content : '';
    const usage = isObj(j.usage) ? j.usage : {};
    return { data: jsonFromText(text), inputTokens: num(usage.prompt_tokens), outputTokens: num(usage.completion_tokens) };
  }

  if (p.kind === 'gemini') {
    if (p.model.includes('/')) throw new Error('The Gemini model name is not valid');
    const res = await deps.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': p.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: p.file.mime, data: b64 } }, { text: p.instructions }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: p.schema, maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) throw refused(name, res.status);
    const j = await json(res);
    const cand = Array.isArray(j.candidates) && isObj(j.candidates[0]) ? j.candidates[0] : {};
    const content = isObj(cand.content) ? cand.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.map((x) => (isObj(x) && typeof x.text === 'string' ? x.text : '')).join('');
    const usage = isObj(j.usageMetadata) ? j.usageMetadata : {};
    return { data: jsonFromText(text), inputTokens: num(usage.promptTokenCount), outputTokens: num(usage.candidatesTokenCount) };
  }

  if (p.kind === 'anthropic') {
    const res = await deps.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model,
        max_tokens: maxTokens,
        tools: [{ name: p.schemaName, description: 'Give back what the document says.', input_schema: p.schema }],
        tool_choice: { type: 'tool', name: p.schemaName },
        messages: [
          {
            role: 'user',
            content: [
              { type: isPdf ? 'document' : 'image', source: { type: 'base64', media_type: p.file.mime, data: b64 } },
              { type: 'text', text: p.instructions },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw refused(name, res.status);
    const j = await json(res);
    const blocks = Array.isArray(j.content) ? j.content : [];
    const tool = blocks.find((x) => isObj(x) && x.type === 'tool_use');
    if (!isObj(tool) || !isObj(tool.input)) throw new Error('The AI did not answer with data');
    const usage = isObj(j.usage) ? j.usage : {};
    return { data: tool.input, inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens) };
  }

  // Ollama: the company's own server, same address rules as chat (no redirects).
  const base = assertSafeOllamaUrl(p.baseUrl ?? '');
  const res = await deps.fetch(new URL('/api/chat', base).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
    body: JSON.stringify({
      model: p.model,
      stream: false,
      format: p.schema,
      messages: [{ role: 'user', content: p.instructions, images: [b64] }],
    }),
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) throw new Error('The Ollama address redirects. Save the final https address instead.');
  if (!res.ok) throw refused(name, res.status);
  const j = await json(res);
  const msg = isObj(j.message) ? j.message : {};
  return {
    data: jsonFromText(typeof msg.content === 'string' ? msg.content : ''),
    inputTokens: num(j.prompt_eval_count),
    outputTokens: num(j.eval_count),
  };
}

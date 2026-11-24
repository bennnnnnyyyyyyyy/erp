import { describe, expect, it } from 'vitest';
import { jsonFromText, type ReaderKind, readDocument, toBase64 } from '../src/lib/aiProviders';
import { chooseReader } from '../src/lib/aiService';

// sql/108, scanning step 0: the six AI providers that read a picture or a PDF. Recorded fake answers only: nothing real is called.

type Call = { url: string; init: RequestInit };
const fake = (reply: unknown, status = 200) => {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(reply), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { deps: { fetch: fetchFn }, calls };
};
const hdr = (c: Call | undefined, name: string) => (c?.init.headers as Record<string, string> | undefined)?.[name];
const body = (c: Call | undefined) => JSON.parse(String(c?.init.body ?? '{}'));

const png = { bytes: new Uint8Array([137, 80, 78, 71]).buffer, mime: 'image/png' };
const pdf = { bytes: new TextEncoder().encode('%PDF-1.4').buffer as ArrayBuffer, mime: 'application/pdf' };
const schema = { type: 'object', properties: { billNumber: { type: 'string' } }, required: ['billNumber'], additionalProperties: false };
const base = { apiKey: 'key-123456789', model: 'm1', instructions: 'Read it', schemaName: 'bill', schema };
const answer = { billNumber: 'INV-7' };

describe('reading a document: one door, six providers', () => {
  it('OpenAI: picture as a data address, strict JSON shape, tokens read', async () => {
    const f = fake({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 900, completion_tokens: 40 } });
    const r = await readDocument({ ...base, kind: 'openai', file: png }, f.deps);
    expect(r).toEqual({ data: answer, inputTokens: 900, outputTokens: 40 });
    expect(f.calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(hdr(f.calls[0], 'Authorization')).toBe('Bearer key-123456789');
    const b = body(f.calls[0]);
    expect(b.response_format.json_schema).toMatchObject({ name: 'bill', strict: true, schema });
    expect(b.messages[0].content[1].image_url.url).toBe(`data:image/png;base64,${toBase64(png.bytes)}`);
    expect(b.max_completion_tokens).toBe(4000);
  });

  it('OpenAI and OpenRouter send a PDF as a file', async () => {
    for (const kind of ['openai', 'openrouter'] as const) {
      const f = fake({ choices: [{ message: { content: JSON.stringify(answer) } }] });
      await readDocument({ ...base, kind, file: pdf }, f.deps);
      expect(body(f.calls[0]).messages[0].content[1].type).toBe('file');
    }
  });

  it('Grok and OpenRouter use their own addresses and max_tokens', async () => {
    for (const [kind, url] of [
      ['grok', 'https://api.x.ai/v1/chat/completions'],
      ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
    ] as const) {
      const f = fake({ choices: [{ message: { content: `Here it is:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` } }] });
      const r = await readDocument({ ...base, kind, model: 'vendor/model-1', file: png }, f.deps);
      expect(r.data).toEqual(answer);
      expect(f.calls[0]?.url).toBe(url);
      expect(body(f.calls[0]).max_tokens).toBe(4000);
    }
  });

  it('Gemini: key in its header, file inline, JSON shape asked for', async () => {
    const f = fake({
      candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20 },
    });
    const r = await readDocument({ ...base, kind: 'gemini', model: 'gemini-2.5-flash', file: pdf }, f.deps);
    expect(r).toEqual({ data: answer, inputTokens: 300, outputTokens: 20 });
    expect(f.calls[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(hdr(f.calls[0], 'x-goog-api-key')).toBe('key-123456789');
    const b = body(f.calls[0]);
    expect(b.contents[0].parts[0].inline_data.mime_type).toBe('application/pdf');
    expect(b.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: schema });
  });

  it('Claude: a forced tool gives the fixed shape; PDF as a document block', async () => {
    const f = fake({
      content: [
        { type: 'text', text: 'ok' },
        { type: 'tool_use', name: 'bill', input: answer },
      ],
      usage: { input_tokens: 50, output_tokens: 9 },
    });
    const r = await readDocument({ ...base, kind: 'anthropic', file: pdf }, f.deps);
    expect(r).toEqual({ data: answer, inputTokens: 50, outputTokens: 9 });
    expect(f.calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(hdr(f.calls[0], 'x-api-key')).toBe('key-123456789');
    const b = body(f.calls[0]);
    expect(b.tool_choice).toEqual({ type: 'tool', name: 'bill' });
    expect(b.tools[0].input_schema).toEqual(schema);
    expect(b.messages[0].content[0].type).toBe('document');
  });

  it('Ollama: the company address, the picture in images, the shape in format, no redirects', async () => {
    const f = fake({ message: { content: JSON.stringify(answer) }, prompt_eval_count: 10, eval_count: 5 });
    const r = await readDocument({ ...base, kind: 'ollama', apiKey: '', baseUrl: 'https://ai.example.com', file: png }, f.deps);
    expect(r.data).toEqual(answer);
    expect(f.calls[0]?.url).toBe('https://ai.example.com/api/chat');
    expect(f.calls[0]?.init.redirect).toBe('manual');
    expect(body(f.calls[0]).format).toEqual(schema);
    await expect(readDocument({ ...base, kind: 'ollama', baseUrl: 'https://127.0.0.1', file: png }, f.deps)).rejects.toThrow();
  });

  it('Grok and Ollama refuse a PDF before any request', async () => {
    for (const kind of ['grok', 'ollama'] as ReaderKind[]) {
      const f = fake({});
      await expect(readDocument({ ...base, kind, baseUrl: 'https://ai.example.com', file: pdf }, f.deps)).rejects.toThrow(
        /cannot read PDF/,
      );
      expect(f.calls).toHaveLength(0);
    }
  });

  it('a refusal never carries the key or the provider body', async () => {
    const f = fake({ error: { message: 'Incorrect API key provided: key-123456789' } }, 401);
    const p = readDocument({ ...base, kind: 'openai', file: png }, f.deps);
    await expect(p).rejects.toThrow('OpenAI refused the request (the key was refused)');
    await expect(readDocument({ ...base, kind: 'gemini', file: png }, fake({}, 401).deps)).rejects.not.toThrow(/key-1/);
  });

  it('an answer without data is an error, not an empty draft', async () => {
    await expect(
      readDocument({ ...base, kind: 'openai', file: png }, fake({ choices: [{ message: { content: 'sorry' } }] }).deps),
    ).rejects.toThrow('The AI did not answer with data');
    await expect(
      readDocument({ ...base, kind: 'anthropic', file: png }, fake({ content: [{ type: 'text', text: 'x' }] }).deps),
    ).rejects.toThrow();
    expect(() => jsonFromText('{"a": ')).toThrow();
  });

  it('a model name that could change the address is refused', async () => {
    await expect(readDocument({ ...base, kind: 'gemini', model: '../x', file: png }, fake({}).deps)).rejects.toThrow(/not valid/);
    await expect(readDocument({ ...base, kind: 'openai', model: 'a b', file: png }, fake({}).deps)).rejects.toThrow(/not valid/);
  });
});

describe('which AI reads (own key only)', () => {
  const on = (credentials: Record<string, string>) => ({ enabled: true, credentials });
  const off = { enabled: false, credentials: {} };
  const s = (providers: Record<string, unknown>, reader: string | null = null) =>
    ({ consent: true, providers: { openai: off, elevenlabs: off, ollama: off, ...providers }, reader }) as Parameters<
      typeof chooseReader
    >[0];

  it('nothing on, or OpenAI on with our key only: nobody reads', () => {
    expect(chooseReader(s({}))).toBeNull();
    expect(chooseReader(s({ openai: on({}) }))).toBeNull();
  });
  it('the chosen one when usable, else the first usable in a fixed order', () => {
    const p = { openai: on({ api_key: 'k1' }), gemini: on({ api_key: 'k2' }) };
    expect(chooseReader(s(p))?.kind).toBe('openai');
    expect(chooseReader(s(p, 'gemini'))).toMatchObject({ kind: 'gemini', model: 'gemini-flash-latest' });
    expect(chooseReader(s(p, 'grok'))?.kind).toBe('openai');
  });
  it('Grok and OpenRouter need a model; Ollama needs its address', () => {
    expect(chooseReader(s({ grok: on({ api_key: 'k' }) }))).toBeNull();
    expect(chooseReader(s({ grok: on({ api_key: 'k', model: 'g' }) }))?.kind).toBe('grok');
    expect(chooseReader(s({ ollama: on({ model: 'llava' }) }))).toBeNull();
    expect(chooseReader(s({ ollama: on({ model: 'llava', base_url: 'https://ai.example.com' }) }))?.kind).toBe('ollama');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import type { Bindings } from '../src/env';
import { aiCapUsd, aiCompanyCapUsd } from '../src/lib/ai';
import {
  assertSafeOllamaUrl,
  chatCostMicro,
  chatOllama,
  chatOpenAI,
  estimateSeconds,
  transcribeElevenLabs,
  transcribeOpenAI,
} from '../src/lib/aiProviders';
import { searchWords } from '../src/modules/core/aiRoutes';

// AI and voice (sql/056, sql/060, proved by sql/tests/051 and 055). Providers run against fakes here: nothing real is called.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' } as Bindings;
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

describe('caps', () => {
  it('default to USD 100 a month in all and USD 25 a company, and can be set', () => {
    expect(aiCapUsd({})).toBe(100);
    expect(aiCapUsd({ AI_MONTHLY_CAP_USD: '40' })).toBe(40);
    expect(aiCapUsd({ AI_MONTHLY_CAP_USD: 'nope' })).toBe(100);
    expect(aiCompanyCapUsd({})).toBe(25);
    expect(aiCompanyCapUsd({ AI_COMPANY_CAP_USD: '10' })).toBe(10);
  });
  it('estimates cost upward and audio length from size', () => {
    expect(chatCostMicro(1000, 200)).toBe(650);
    expect(estimateSeconds(160000)).toBe(10);
    expect(estimateSeconds(10)).toBe(1);
  });
});

describe('Ollama address safety', () => {
  it.each(['https://ai.example.com', 'https://ai.example.com:8443/'])('accepts %s', (u) => {
    expect(assertSafeOllamaUrl(u).protocol).toBe('https:');
  });
  it.each([
    'http://ai.example.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.5:11434',
    'https://[::1]',
    'https://intranet',
    'https://box.local',
    'not a url',
  ])('refuses %s', (u) => {
    expect(() => assertSafeOllamaUrl(u)).toThrow();
  });
});

describe('providers', () => {
  it('OpenAI chat: key in the header, text and token counts read', async () => {
    const f = fake({ choices: [{ message: { content: ' OK ' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
    const r = await chatOpenAI({ apiKey: 'sk-1', model: 'gpt-5-mini', system: 's', user: 'u' }, f.deps);
    expect(r).toEqual({ text: 'OK', inputTokens: 12, outputTokens: 3 });
    expect(f.calls[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(hdr(f.calls[0], 'Authorization')).toBe('Bearer sk-1');
  });
  it('OpenAI failure carries no key and no body', async () => {
    const f = fake({ error: { message: 'bad key sk-1' } }, 401);
    await expect(chatOpenAI({ apiKey: 'sk-1', model: 'm', system: 's', user: 'u' }, f.deps)).rejects.toThrow(
      'OpenAI refused the request (401)',
    );
    await expect(chatOpenAI({ apiKey: 'sk-1', model: 'm', system: 's', user: 'u' }, f.deps)).rejects.not.toThrow(/sk-1/);
  });
  it('Ollama chat: the company address, optional bearer, counts read', async () => {
    const f = fake({ message: { content: 'hello' }, prompt_eval_count: 7, eval_count: 2 });
    const r = await chatOllama({ baseUrl: 'https://ai.example.com', model: 'qwen', apiKey: 'k', system: 's', user: 'u' }, f.deps);
    expect(r).toEqual({ text: 'hello', inputTokens: 7, outputTokens: 2 });
    expect(f.calls[0]?.url).toBe('https://ai.example.com/api/chat');
    expect(hdr(f.calls[0], 'Authorization')).toBe('Bearer k');
  });
  it('Ollama refuses an unsafe address before any request', async () => {
    const f = fake({});
    await expect(chatOllama({ baseUrl: 'https://127.0.0.1', model: 'm', system: 's', user: 'u' }, f.deps)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it('speech to text: OpenAI and ElevenLabs read the text', async () => {
    const audio = { bytes: new Uint8Array([1, 2, 3]).buffer, name: 'a.webm', type: 'audio/webm' };
    const a = fake({ text: ' مرحبا ' });
    expect((await transcribeOpenAI({ apiKey: 'k', audio, language: 'ar' }, a.deps)).text).toBe('مرحبا');
    expect(a.calls[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    const b = fake({ text: 'hi' });
    expect((await transcribeElevenLabs({ apiKey: 'k', audio }, b.deps)).text).toBe('hi');
    expect(hdr(b.calls[0], 'xi-api-key')).toBe('k');
  });
});

describe('assistant', () => {
  it('searches on words of three or more letters or digits, in any language, at most six', () => {
    expect(searchWords('How many SKU-100 do we have in Cairo?')).toEqual(['how', 'many', 'sku-100', 'have', 'cairo']);
    expect(searchWords('كم عدد الزيت المتبقي؟')).toContain('الزيت');
    expect(searchWords('a b c')).toEqual([]);
    expect(searchWords('one two three four five six seven eight')).toHaveLength(6);
  });
  it('filter words cannot carry filter syntax', () => {
    for (const w of searchWords('x,or(a.eq.1) "quote" %percent% name.ilike.%a%')) expect(w).toMatch(/^[\p{L}\p{N}-]+$/u);
  });
});

describe('AI routes', () => {
  const routes: [string, string][] = [
    ['POST', '/v1/core/ai/assistant'],
    ['POST', '/v1/core/ai/test'],
    ['POST', '/v1/core/ai/transcribe'],
  ];
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    expect((await app.request(path, { method }, env)).status).toBe(401);
  });

  const routeSrc = readFileSync(join(__dirname, '../src/modules/core/aiRoutes.ts'), 'utf8');
  it('the route file reads with the caller sign-in only and never writes or imports the secret-key client', () => {
    expect(routeSrc).not.toMatch(/db\.admin/);
    expect(routeSrc).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(routeSrc).toContain("from('inv_items')");
    expect(routeSrc).toContain('userDb(c)');
  });
  it('the service file keeps to consent, the caps and our own model for our own key', () => {
    const svc = readFileSync(join(__dirname, '../src/lib/aiService.ts'), 'utf8');
    expect(svc).toContain('checkCaps');
    expect(svc).toContain('ai__provider_state');
    expect(svc).toMatch(/ownKey \? openai\.credentials\.model/);
    expect(svc).not.toMatch(/from\('/);
  });
});

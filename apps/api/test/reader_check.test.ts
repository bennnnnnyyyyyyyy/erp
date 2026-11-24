import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../src/env';
import { READER_DEFAULT_MODEL } from '../src/lib/aiProviders';
import { checkIntegration } from '../src/lib/integrationChecks';

// "Check connection" for an AI that reads bills (scanning step 0). 24 Nov 2026: a free Gemini key no longer had gemini-2.5-flash, our
// default then; the check passed (no model saved) and the first scan failed. The check now tests the model reading will really use.

const env = { APP_ENV: 'test', SUPABASE_URL: 'https://db.test', SUPABASE_SECRET_KEY: 'sb_secret_test' } as Bindings;
const who = { orgId: '11111111-1111-4111-8111-111111111111', email: 'o@test.invalid', apiBase: 'https://api.erp.test' };

/** The saved key (and model) come from the database through the secret-key client's fetch. */
function savedCredentials(c: Record<string, string>) {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(c), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}
afterEach(() => vi.unstubAllGlobals());

/** Google: lists `listed`; asked for one model, knows only `known`. */
function google(listed: string[], known: string[] = []) {
  const urls: string[] = [];
  const deps = {
    fetch: (async (input: string) => {
      urls.push(input);
      const one = input.match(/\/v1beta\/models\/([^?]+)$/);
      if (one) return new Response('{}', { status: known.includes(one[1] as string) ? 200 : 404 });
      return new Response(JSON.stringify({ models: listed.map((m) => ({ name: `models/${m}` })) }), { status: 200 });
    }) as unknown as typeof fetch,
  };
  return { urls, deps };
}

describe('Check connection for Gemini', () => {
  it('uses a default that is not a pinned old version', () => {
    expect(READER_DEFAULT_MODEL.gemini).toBe('gemini-flash-latest');
  });

  it('checks the default model when none is saved, and names models the key has', async () => {
    savedCredentials({ api_key: 'AIzaTEST' });
    const g = google(['gemini-9-pro', 'gemini-9-flash', 'embedding-001']);
    const r = await checkIntegration(env, 'gemini', who, g.deps);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('gemini-flash-latest (the default, as no model is saved)');
    expect(r.message).toContain('for example: gemini-9-flash, gemini-9-pro');
    expect(r.message).not.toContain('AIzaTEST');
  });

  it('accepts a model Google knows by name even when its list leaves it out', async () => {
    savedCredentials({ api_key: 'AIzaTEST' });
    const g = google(['gemini-9-flash'], ['gemini-flash-latest']);
    const r = await checkIntegration(env, 'gemini', who, g.deps);
    expect(r).toEqual({ ok: true, message: 'Gemini accepted your key. Model: gemini-flash-latest.' });
    expect(g.urls[1]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest');
  });

  it('accepts a saved model the key has', async () => {
    savedCredentials({ api_key: 'AIzaTEST', model: 'gemini-9-flash' });
    const r = await checkIntegration(env, 'gemini', who, google(['gemini-9-flash']).deps);
    expect(r.ok).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import app from '../src/index';

// Invoice printing (sql/103; the database side is tested in sql/tests/100).
const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

describe('invoice printing routes need a signed-in user', () => {
  const routes: [string, string][] = [
    ['GET', '/v1/sales/invoice-drafts'],
    ['POST', '/v1/sales/invoice-drafts'],
    ['POST', `/v1/sales/invoice-drafts/${ID}/issue`],
    ['POST', `/v1/sales/invoice-drafts/${ID}/discard`],
    ['GET', `/v1/sales/print/invoice/${ID}`],
    ['GET', `/v1/sales/documents/invoice/${ID}/link`],
    ['POST', `/v1/sales/documents/invoice/${ID}/link`],
    ['POST', `/v1/sales/documents/invoice/${ID}/link/revoke`],
    ['GET', `/v1/sales/documents/invoice/${ID}/sends`],
    ['POST', `/v1/sales/documents/invoice/${ID}/sends`],
    ['GET', '/v1/core/doc-settings'],
    ['PUT', '/v1/core/doc-settings'],
  ];
  it.each(routes)('%s %s answers 401 without a token', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
  });
});

describe('GET /i/:token (customer invoice link)', () => {
  const withDb = { ...env, SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_PUBLISHABLE_KEY: 'pk' };

  it('answers a bare 404 for a malformed token without calling the database', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    for (const bad of ['nope', 'a'.repeat(63), 'a'.repeat(65), 'G'.repeat(64), 'A'.repeat(64)]) {
      const res = await app.request(`/i/${bad}`, {}, withDb);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('answers the print data for a good token with the publishable key only, and a bare 404 when the database refuses', async () => {
    const token = 'ab'.repeat(32);
    const seen: { url: string; body: string; key: string | null; auth: string | null }[] = [];
    const doc = {
      document: { type: 'invoice', number: 'INV-2026-00001' },
      lines: [],
      customer: null,
      company: { name: 'A' },
      settings: {},
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const h = new Headers(init?.headers);
      seen.push({ url: String(input), body: String(init?.body), key: h.get('apikey'), auth: h.get('Authorization') });
      if (String(init?.body).includes(token))
        return new Response(JSON.stringify(doc), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ code: 'P0001', message: 'NOT_FOUND', details: null, hint: null }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const good = await app.request(`/i/${token}`, {}, withDb);
    expect(good.status).toBe(200);
    expect(good.headers.get('Cache-Control')).toBe('no-store');
    expect(good.headers.get('Referrer-Policy')).toBe('no-referrer');
    const body = (await good.json()) as { success: boolean; data: { document: { number: string } } };
    expect(body.data.document.number).toBe('INV-2026-00001');
    expect(seen[0]?.url).toContain('/rest/v1/rpc/sal_doc_link_print');
    expect(seen[0]?.key).toBe('pk');
    const refused = await app.request(`/i/${'cd'.repeat(32)}`, {}, withDb);
    expect(refused.status).toBe(404);
    expect(await refused.text()).toBe('');
    fetchSpy.mockRestore();
  });

  it('answers 503 not_set_up when the database function does not exist yet', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.sal_doc_link_print', details: null, hint: null }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    const res = await app.request(`/i/${'ef'.repeat(32)}`, {}, withDb);
    expect(res.status).toBe(503);
    fetchSpy.mockRestore();
  });
});

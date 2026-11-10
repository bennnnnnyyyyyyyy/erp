import { describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { toCsv } from '../src/lib/csv';

// Private report links for Google Sheets (sql/070; the database side is tested in sql/tests/066).
const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

describe('report link routes need a signed-in user', () => {
  const routes: [string, string][] = [
    ['GET', '/v1/core/report-links'],
    ['POST', '/v1/core/report-links'],
    ['POST', `/v1/core/report-links/${ID}/revoke`],
  ];
  it.each(routes)('%s %s answers 401 without a token', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
  });
});

describe('GET /r/:token', () => {
  it('answers a bare 404 for a malformed token without calling the database', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const withDb = { ...env, SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_PUBLISHABLE_KEY: 'pk' };
    for (const bad of ['nope', 'a'.repeat(63), 'a'.repeat(65), 'G'.repeat(64), 'A'.repeat(64)]) {
      const res = await app.request(`/r/${bad}`, {}, withDb);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('answers CSV with no-store for a good token, and 404 when the database refuses', async () => {
    const token = 'ab'.repeat(32);
    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push(`${String(input)} ${String(init?.body)}`);
      const body = String(init?.body);
      if (body.includes(token)) {
        return new Response(JSON.stringify({ report: 'sales_by_month', columns: ['Month', 'Total'], rows: [['2026-03', '50.00']] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ code: 'P0001', message: 'NOT_FOUND', details: null, hint: null }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const withDb = { ...env, SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_PUBLISHABLE_KEY: 'pk' };
    const good = await app.request(`/r/${token}`, {}, withDb);
    expect(good.status).toBe(200);
    expect(good.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(good.headers.get('Cache-Control')).toBe('no-store');
    expect(await good.text()).toBe('Month,Total\r\n2026-03,50.00\r\n');
    const refused = await app.request(`/r/${'cd'.repeat(32)}`, {}, withDb);
    expect(refused.status).toBe(404);
    expect(await refused.text()).toBe('');
    expect(calls[0]).toContain('core_report_link_rows');
    fetchSpy.mockRestore();
  });
});

describe('toCsv', () => {
  it('writes a header row and CRLF line ends, with no byte-order mark', () => {
    expect(toCsv(['A', 'B'], [['1', '2']])).toBe('A,B\r\n1,2\r\n');
    expect(toCsv(['A'], []).startsWith('A')).toBe(true);
  });
  it('quotes commas, quotes and newlines', () => {
    expect(toCsv(['x'], [['a,b'], ['say "hi"'], ['two\nlines']])).toBe('x\r\n"a,b"\r\n"say ""hi"""\r\n"two\nlines"\r\n');
  });
  it('keeps Arabic text and empty cells', () => {
    // The Arabic comma is not a separator, so it needs no quotes; the ASCII comma does.
    expect(
      toCsv(
        ['العميل', 'ملاحظة'],
        [
          ['شركة النور، القاهرة', null],
          ['النور, القاهرة', 'x'],
        ],
      ),
    ).toBe('العميل,ملاحظة\r\nشركة النور، القاهرة,\r\n"النور, القاهرة",x\r\n');
  });
  it('defuses text that a spreadsheet would read as a formula', () => {
    expect(toCsv(['x'], [['=1+1']])).toBe('x\r\n"\'=1+1"\r\n');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// System audit 2026-11-03, finding 1: balances and single records are read from the server, never computed from the capped lists.
// These cover the API layer; the data itself comes from the same tables the SQL tests (sql/tests/020, 018, 014) already cover.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

const routes: [string, string][] = [
  ['GET', `/v1/finance/payments?for=c:${ID}`],
  ['GET', `/v1/finance/payments/${ID}`],
  ['GET', `/v1/finance/expenses/${ID}`],
  ['GET', '/v1/finance/open-items?direction=in'],
  ['GET', '/v1/finance/open-items?direction=out'],
  ['GET', `/v1/sales/invoices/${ID}`],
  ['GET', `/v1/purchasing/supplier-invoices/${ID}`],
];

describe('record and balance endpoints', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
  });

  const read = (rel: string) => readFileSync(join(__dirname, '../src', rel), 'utf8');
  const finance = read('modules/finance/routes.ts');
  const balances = finance.slice(finance.indexOf('reading payments and balances'), finance.indexOf('The owner home numbers'));

  it('guards every new finance read with the finance report permission', () => {
    const declared = balances.match(/financeRoutes\.get\(/g) ?? [];
    const guarded = balances.match(/financeRoutes\.get\([^\n]*requirePermission\('finance\.reports\.view'\)/g) ?? [];
    expect(declared.length).toBe(4);
    expect(guarded.length).toBe(declared.length);
  });

  it('only reads: no writes in the balance code', () => {
    expect(balances).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it('pages through all rows instead of stopping at the first 1000', () => {
    expect(balances).toContain('async function fetchAll');
    expect(balances).toMatch(/\.range\(from, to\)/);
    expect((balances.match(/fetchAll</g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it('counts only recorded payments of the right direction as paid', () => {
    const open = balances.slice(balances.indexOf("'/open-items'"));
    expect(open).toContain(".eq('status', 'recorded')");
    expect(open).toContain(".eq('direction', direction)");
  });

  it('puts the invoice permission on the single-invoice reads', () => {
    expect(read('modules/sales/routes.ts')).toMatch(/salesRoutes\.get\('\/invoices\/:id', requirePermission\('sales\.invoices\.read'\)/);
    expect(read('modules/purchasing/routes.ts')).toMatch(
      /purchasingRoutes\.get\('\/supplier-invoices\/:id', requirePermission\('purchasing\.invoices\.read'\)/,
    );
  });
});

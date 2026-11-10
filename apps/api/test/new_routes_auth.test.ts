import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// Routes added on 9-10 Nov 2026 (record editing sql/062, partial receipts sql/064, stock count screens, the item page). The database
// functions are tested in sql/tests/057, 059 and 037; here: every route needs a signed-in user, and the item page's reads are what
// they claim to be.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

const routes: [string, string][] = [
  ['GET', `/v1/inventory/ledger?itemId=${ID}`],
  ['GET', '/v1/inventory/item-costs'],
  ['PUT', `/v1/inventory/items/${ID}`],
  ['PUT', `/v1/sales/customers/${ID}`],
  ['PUT', `/v1/purchasing/suppliers/${ID}`],
  ['POST', `/v1/purchasing/orders/${ID}/receive`],
  ['GET', '/v1/inventory/counts'],
  ['POST', '/v1/inventory/counts'],
  ['PUT', `/v1/inventory/counts/${ID}/lines`],
  ['POST', `/v1/inventory/counts/${ID}/submit`],
  ['POST', `/v1/inventory/counts/${ID}/approve`],
  ['POST', `/v1/inventory/counts/${ID}/cancel`],
  ['POST', '/v1/core/org/blind-counts'],
  // bank statements (sql/067)
  ['PUT', '/v1/treasury/statements/reconcile-roles'],
  ['GET', `/v1/treasury/statements/accounts/${ID}/format`],
  ['PUT', `/v1/treasury/statements/accounts/${ID}/format`],
  ['POST', `/v1/treasury/statements/accounts/${ID}/imports`],
  ['GET', '/v1/treasury/statements/imports'],
  ['GET', `/v1/treasury/statements/imports/${ID}`],
  ['GET', `/v1/treasury/statements/accounts/${ID}/unmatched`],
  ['POST', `/v1/treasury/statements/lines/${ID}/match`],
  ['POST', `/v1/treasury/statements/lines/${ID}/unmatch`],
  ['POST', `/v1/treasury/statements/lines/${ID}/ignore`],
  ['POST', `/v1/treasury/statements/imports/${ID}/confirm-exact`],
  ['GET', `/v1/treasury/statements/accounts/${ID}/reconciliations`],
  ['POST', `/v1/treasury/statements/accounts/${ID}/reconcile`],
  ['POST', `/v1/treasury/statements/reconciliations/${ID}/reopen`],
  // bank statements part 2 (sql/068)
  ['GET', '/v1/treasury/statements/reconcile-roles'],
  ['POST', '/v1/treasury/statements/bank-charges/prepare'],
  ['GET', '/v1/treasury/statements/rules'],
  ['POST', '/v1/treasury/statements/rules'],
  ['PUT', `/v1/treasury/statements/rules/${ID}`],
  ['DELETE', `/v1/treasury/statements/rules/${ID}`],
  ['POST', `/v1/treasury/statements/lines/${ID}/explain`],
  // purchase order approval (sql/069)
  ['POST', `/v1/purchasing/orders/${ID}/decide`],
  ['GET', '/v1/purchasing/order-approval'],
  ['PUT', '/v1/purchasing/order-approval'],
  ['POST', `/v1/purchasing/orders/${ID}/confirm`], // sql/073
];

describe('a migration not applied yet', () => {
  it('is recognised from the database error codes (so the API answers 503 not_set_up, not 500)', async () => {
    const { isMissingSchema } = await import('../src/lib/errors');
    for (const code of ['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'])
      expect(isMissingSchema({ code, message: 'x' })).toBe(true);
    for (const e of [{ code: '23505' }, new Error('x'), null, undefined, { code: 42883 }]) expect(isMissingSchema(e)).toBe(false);
  });
});

describe('routes added on 9-10 November', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
  });

  const src = readFileSync(join(__dirname, '../src/modules/inventory/routes.ts'), 'utf8');
  it('item costs come from the owner-and-admin database function, not a table read', () => {
    const route = src.slice(src.indexOf("inventoryRoutes.get('/item-costs'"), src.indexOf('// Fix an item'));
    expect(route).toContain("'inv_item_costs'");
    expect(route).not.toMatch(/\.from\(/);
  });
  it('the ledger checks the item id before using it', () => {
    const route = src.slice(src.indexOf("inventoryRoutes.get('/ledger'"), src.indexOf("inventoryRoutes.get('/requests'"));
    expect(route).toMatch(/UUID_RE\.test\(itemId\)/);
  });
});

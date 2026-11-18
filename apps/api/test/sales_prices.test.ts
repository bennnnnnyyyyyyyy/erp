import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// Prices (sql/097, MASTER_DATA_PLAN.md slice C). The database rules are tested in sql/tests/093_sal_prices.sql; these tests cover the
// API layer in front of them.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

const routes: [string, string][] = [
  ['GET', '/v1/sales/customer-groups'],
  ['POST', '/v1/sales/customer-groups'],
  ['PUT', `/v1/sales/customer-groups/${ID}`],
  ['DELETE', `/v1/sales/customer-groups/${ID}`],
  ['PUT', `/v1/sales/customers/${ID}/group`],
  ['GET', `/v1/sales/items/${ID}/prices`],
  ['PUT', `/v1/sales/items/${ID}/price`],
  ['PUT', '/v1/sales/price-settings'],
  ['GET', '/v1/sales/price-lists'],
  ['GET', `/v1/sales/price-lists/${ID}/items`],
  ['POST', '/v1/sales/price-lists'],
  ['PUT', `/v1/sales/price-lists/${ID}`],
  ['DELETE', `/v1/sales/price-lists/${ID}`],
  ['PUT', `/v1/sales/price-lists/${ID}/items/${ID}`],
  ['GET', `/v1/sales/prices?customerId=${ID}&itemIds=${ID}`],
  ['GET', '/v1/purchasing/supplier-prices'],
];

const source = readFileSync(join(__dirname, '../src/modules/sales/prices.ts'), 'utf8');

describe('prices API', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
  });

  it('puts a permission check on every route, and changes prices only with the manage permission', () => {
    const declared = source.match(/salesRoutes\.(get|post|put|delete)\(/g) ?? [];
    const guarded = source.match(/salesRoutes\.(get|post|put|delete)\([^\n]*requirePermission\('sales\.[a-z_.]+'\)/g) ?? [];
    expect(declared.length).toBe(routes.length - 1);
    expect(guarded.length).toBe(declared.length);
    const writes = source.match(/salesRoutes\.(post|put|delete)\('[^']+', requirePermission\('[a-z_.]+'\)/g) ?? [];
    for (const w of writes) {
      if (w.includes("'/customers/:id/group'")) expect(w).toContain("'sales.customers.manage'");
      else expect(w).toContain("'sales.prices.manage'");
    }
  });

  it('writes only through the database functions', () => {
    for (const fn of [
      'sal_save_customer_group',
      'sal_delete_customer_group',
      'sal_set_customer_group',
      'sal_item_price_info',
      'sal_set_item_price',
      'sal_set_default_markup',
      'sal_save_price_list',
      'sal_delete_price_list',
      'sal_set_price_list_item',
      'sal_prices_for',
    ]) {
      expect(source).toContain(`'${fn}'`);
    }
    expect(source.replaceAll('salesRoutes.delete(', '')).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it('lets members read prices but only owners and admins change them', () => {
    // read from this repository's source (a worktree may resolve @erp/shared to another checkout)
    const manifest = readFileSync(join(__dirname, '../../../packages/shared/src/modules.ts'), 'utf8');
    const sales = manifest.slice(manifest.indexOf("key: 'sales'"));
    const [permissions, rest] = sales.split('memberGrants:');
    const memberGrants = (rest ?? '').slice(0, (rest ?? '').indexOf(']'));
    expect(permissions).toContain("'sales.prices.read'");
    expect(permissions).toContain("'sales.prices.manage'");
    expect(memberGrants).not.toContain("'sales.prices.manage'");
    expect(manifest).toContain("'purchasing.prices.view'");
  });

  it('keeps the customer list working before sql/097 (falls back without customer_group_id)', () => {
    const routesSource = readFileSync(join(__dirname, '../src/modules/sales/routes.ts'), 'utf8');
    expect(routesSource).toContain('${CUSTOMER_DETAIL_COLUMNS},customer_group_id`');
    expect(routesSource).toMatch(
      /isMissingSchema\(error\)\)\s*\(\{ data, error \} = await read\(`id,code,name,contact,city,phone,payment_terms_days,\$\{CUSTOMER_DETAIL_COLUMNS\}`\)\)/,
    );
  });
});

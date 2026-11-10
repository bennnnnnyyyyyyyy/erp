import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPermissionsFor, findModule } from '@erp/shared';
import app from '../src/index';
import { csvCell } from '../src/lib/csv';

// Phase 2 API (documentation/plans/TREASURY_PLAN.md §4-5): treasury, branches, statements, party codes. The rules themselves live in
// the database and are proved by sql/tests/045-047; these cover sign-in, an explicit permission on every route, and no direct writes.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';
const read = (rel: string) => readFileSync(join(__dirname, '../src', rel), 'utf8');
const treasury = read('modules/treasury/routes.ts');
const branches = read('modules/core/branchRoutes.ts');
const finance = read('modules/finance/routes.ts');
const statements = finance.slice(finance.indexOf('---- statements of account'));

const routes: [string, string][] = [
  ['GET', '/v1/treasury/accounts'],
  ['POST', '/v1/treasury/accounts'],
  ['PATCH', `/v1/treasury/accounts/${ID}`],
  ['GET', `/v1/treasury/accounts/${ID}/lines?from=2026-01-01&to=2026-12-31`],
  ['POST', '/v1/treasury/setup/prepare'],
  ['GET', '/v1/treasury/transfers'],
  ['POST', '/v1/treasury/transfers'],
  ['POST', `/v1/treasury/transfers/${ID}/void`],
  ['GET', '/v1/core/branches'],
  ['POST', '/v1/core/branches'],
  ['PATCH', `/v1/core/branches/${ID}`],
  ['PUT', `/v1/inventory/warehouses/${ID}/branch`],
  ['GET', `/v1/finance/statements/party?type=customer&id=${ID}&from=2026-01-01&to=2026-12-31`],
  ['GET', `/v1/finance/statements/item?itemId=${ID}&from=2026-01-01&to=2026-12-31`],
  ['PUT', `/v1/sales/customers/${ID}/code`],
  ['PUT', `/v1/purchasing/suppliers/${ID}/code`],
];

describe('phase 2 routes', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
  });

  it('puts a treasury permission on every treasury route; reads use the view key', () => {
    const declared = treasury.match(/treasuryRoutes\.(get|post|put|patch|delete)\(/g) ?? [];
    const guarded = treasury.match(/treasuryRoutes\.(get|post|put|patch|delete)\([^\n]*requirePermission\('treasury\.[a-z_.]+'\)/g) ?? [];
    expect(declared.length).toBe(8);
    expect(guarded.length).toBe(declared.length);
    const reads = treasury.match(/treasuryRoutes\.get\([^\n]*/g) ?? [];
    expect(reads.every((r) => r.includes("'treasury.accounts.view'"))).toBe(true);
  });

  it('branch changes need the branch key; statements need the statements key', () => {
    expect(branches.match(/branchRoutes\.(post|patch)\([^\n]*requirePermission\('core\.branches\.manage'\)/g)?.length).toBe(2);
    expect(statements.match(/financeRoutes\.get\([^\n]*requirePermission\('finance\.statements\.view'\)/g)?.length).toBe(2);
    expect(read('modules/inventory/warehouses.ts')).toMatch(
      /\.put\('\/warehouses\/:id\/branch', requirePermission\('core\.branches\.manage'\)/,
    );
  });

  it('changes go through database functions only (no direct writes)', () => {
    for (const src of [treasury, branches, statements]) expect(src).not.toMatch(/(?<!Routes)\.(insert|update|delete|upsert)\(/);
    for (const fn of ['trs_balances', 'trs_prepare', 'trs_save_account', 'trs_record_transfer', 'trs_void_transfer', 'acc_account_lines'])
      expect(treasury).toContain(`'${fn}'`);
    expect(branches).toContain("'core_save_branch'");
    expect(statements).toContain("'acc_party_statement'");
    expect(statements).toContain("'inv_item_statement'");
  });

  it('members and viewers get no treasury, branch or statement key; treasury needs accounting', () => {
    for (const role of ['member', 'viewer'] as const) {
      const keys = defaultPermissionsFor(role);
      expect(keys.filter((k) => k.startsWith('treasury.') || k === 'core.branches.manage' || k === 'finance.statements.view')).toEqual([]);
    }
    expect(findModule('treasury')?.dependsOn).toEqual(expect.arrayContaining(['accounting', 'finance']));
  });

  it('defuses spreadsheet formulas in CSV text', () => {
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
});

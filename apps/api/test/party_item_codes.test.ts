import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// Supplier and customer item codes (sql/099, MASTER_DATA_PLAN.md slice B). The database rules are tested in
// sql/tests/096_inv_party_item_codes.sql; these tests cover the API layer in front of them.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

const routes: [string, string][] = [
  ['GET', `/v1/inventory/party-item-codes?itemId=${ID}`],
  ['GET', `/v1/inventory/party-item-codes/find?partyType=supplier&partyId=${ID}&q=FC`],
  ['PUT', `/v1/inventory/items/${ID}/party-codes`],
  ['DELETE', `/v1/inventory/items/${ID}/party-codes/supplier/${ID}`],
];

const source = readFileSync(join(__dirname, '../src/modules/inventory/partyCodes.ts'), 'utf8');

describe('party item codes API', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
  });

  it('reads with the items permission and writes only with the owner/admin party codes permission', () => {
    const declared = source.match(/inventoryRoutes\.(get|post|put|delete)\(/g) ?? [];
    expect(declared.length).toBe(routes.length);
    const reads = source.match(/inventoryRoutes\.get\('[^']+', requirePermission\('([a-z_.]+)'\)/g) ?? [];
    const writes = source.match(/inventoryRoutes\.(put|delete)\('[^']+', requirePermission\('([a-z_.]+)'\)/g) ?? [];
    expect(reads.length + writes.length).toBe(declared.length);
    for (const r of reads) expect(r).toContain("'inventory.items.read'");
    for (const w of writes) expect(w).toContain("'inventory.party_codes.manage'");
    // read from this repository's source (a worktree may resolve @erp/shared to another checkout)
    const manifest = readFileSync(join(__dirname, '../../../packages/shared/src/modules.ts'), 'utf8');
    const inventory = manifest.slice(manifest.indexOf("key: 'inventory'"), manifest.indexOf("suite: 'Warehouse'"));
    const [permissions, memberGrants] = inventory.split('memberGrants:');
    expect(permissions).toContain("'inventory.party_codes.manage'");
    expect(memberGrants).not.toContain("'inventory.party_codes.manage'");
  });

  it('writes only through the database functions', () => {
    for (const fn of ['inv_set_party_item_code', 'inv_remove_party_item_code', 'inv_find_items_by_party_code']) {
      expect(source).toContain(`'${fn}'`);
    }
    expect(source.replaceAll('inventoryRoutes.delete(', '')).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });
});

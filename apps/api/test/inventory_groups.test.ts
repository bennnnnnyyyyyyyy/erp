import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// Item groups and the item code rule (sql/095, MASTER_DATA_PLAN.md slice A). The database rules are tested in
// sql/tests/090_inv_item_groups.sql; these tests cover the API layer in front of them.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

const routes: [string, string][] = [
  ['GET', '/v1/inventory/item-groups'],
  ['POST', '/v1/inventory/item-groups'],
  ['PUT', `/v1/inventory/item-groups/${ID}`],
  ['PUT', `/v1/inventory/item-groups/${ID}/parent`],
  ['DELETE', `/v1/inventory/item-groups/${ID}`],
  ['PUT', `/v1/inventory/items/${ID}/group`],
  ['GET', '/v1/inventory/item-code-rule'],
  ['PUT', '/v1/inventory/item-code-rule'],
];

const source = readFileSync(join(__dirname, '../src/modules/inventory/groups.ts'), 'utf8');

describe('item groups API', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
  });

  it('puts a permission check on every route', () => {
    const declared = source.match(/inventoryRoutes\.(get|post|put|delete)\(/g) ?? [];
    const guarded = source.match(/inventoryRoutes\.(get|post|put|delete)\([^\n]*requirePermission\('inventory\.[a-z_.]+'\)/g) ?? [];
    expect(declared.length).toBe(routes.length);
    expect(guarded.length).toBe(declared.length);
  });

  it('changes groups and the rule only with the groups permission, owners and admins only', () => {
    for (const path of ["'/item-groups'", "'/item-groups/:id'", "'/item-groups/:id/parent'", "'/item-code-rule'"]) {
      const writes =
        source.match(new RegExp(`inventoryRoutes\\.(post|put|delete)\\(${path}, requirePermission\\('([a-z.]+)'\\)`, 'g')) ?? [];
      expect(writes.length).toBeGreaterThan(0);
      for (const w of writes) expect(w).toContain("'inventory.groups.manage'");
    }
    // read from this repository's source (a worktree may resolve @erp/shared to another checkout)
    const manifest = readFileSync(join(__dirname, '../../../packages/shared/src/modules.ts'), 'utf8');
    const inventory = manifest.slice(manifest.indexOf("key: 'inventory'"), manifest.indexOf("suite: 'Warehouse'"));
    const [permissions, memberGrants] = inventory.split('memberGrants:');
    expect(permissions).toContain("'inventory.groups.manage'");
    expect(memberGrants).not.toContain("'inventory.groups.manage'");
  });

  it('writes only through the database functions', () => {
    for (const fn of [
      'inv_create_item_group',
      'inv_update_item_group',
      'inv_move_item_group',
      'inv_delete_item_group',
      'inv_set_item_group',
      'inv_item_code_rule',
      'inv_next_item_code',
      'inv_set_item_code_rule',
    ]) {
      expect(source).toContain(`'${fn}'`);
    }
    expect(source.replaceAll('inventoryRoutes.delete(', '')).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it('keeps the item list working before sql/095 (falls back without group_id)', () => {
    const items = readFileSync(join(__dirname, '../src/modules/inventory/items.ts'), 'utf8');
    // Falls back when the column is missing (before sql/095) and when its column grant is missing (sql/095 without sql/096: 42501).
    expect(items).toMatch(
      /isMissingSchema\(error\) \|\| \(error as \{ code\?: string \}\)\.code === '42501'\)\) \(\{ data, error \} = await list\(ITEM_COLUMNS\)\)/,
    );
    // p_group_id is sent only with a group, so the old function still matches before the migration
    expect(items).toContain('...(groupId ? { p_group_id: groupId } : {})');
  });
});

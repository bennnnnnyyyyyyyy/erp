import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { BARCODE_RE } from '../src/modules/inventory/items';

// Barcodes (SCANNING_PLAN.md step 2, sql/108). The database rules (one per item, unique in each company, roles, audit, isolation) are
// tested in sql/tests/105_scanning.sql section C; these tests cover the API layer in front of them.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';
const items = readFileSync(join(__dirname, '../src/modules/inventory/items.ts'), 'utf8');

describe('barcodes API', () => {
  it.each([
    ['GET', '/v1/inventory/items/by-barcode/6221234567890'],
    ['PUT', `/v1/inventory/items/${ID}/barcode`],
  ])('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
  });

  it('checks a permission on both routes: reading to find, managing items to set', () => {
    expect(items).toContain("inventoryRoutes.get('/items/by-barcode/:code', requirePermission('inventory.items.read')");
    expect(items).toContain("inventoryRoutes.put('/items/:id/barcode', requirePermission('inventory.items.manage')");
  });

  it('writes the barcode only through the audited database function', () => {
    expect(items.match(/'inv_set_item_barcode'/g)?.length).toBe(2); // the barcode route and item create
    expect(items).not.toMatch(/\.update\(\s*\{\s*barcode/);
  });

  it('keeps the item list working before sql/108 (falls back without barcode)', () => {
    expect(items).toContain('let { data, error } = await list(ITEM_COLUMNS_WITH_BARCODE);');
    expect(items).toContain('if (fallBack(error)) ({ data, error } = await list(ITEM_COLUMNS_WITH_MAX));');
    expect(items).toContain('const ITEM_COLUMNS_WITH_BARCODE = `${ITEM_COLUMNS_WITH_MAX}, barcode`;');
  });

  it('answers 503 not_set_up for a barcode search before sql/108', () => {
    const route = items.slice(items.indexOf("'/items/by-barcode/:code'"), items.indexOf("'/items/:id/barcode'"));
    expect(route).toContain("'not_set_up'");
    expect(route).toContain(".is('deleted_at', null)");
    expect(route).toContain(".eq('org_id', orgOf(c))");
  });

  it('accepts the barcodes the database accepts', () => {
    for (const ok of ['6221234567890', '012345678905', 'ABC-123/x', 'x'.repeat(64)]) expect(BARCODE_RE.test(ok)).toBe(true);
    for (const bad of ['', 'has space', 'x'.repeat(65), 'عربي', 'tab\there']) expect(BARCODE_RE.test(bad)).toBe(false);
    // the same pattern as the check in sql/108
    const sql = readFileSync(join(__dirname, '../../../sql/108_scanning.sql'), 'utf8');
    expect(sql).toContain("barcode ~ '^[!-~]{1,64}$'");
  });
});

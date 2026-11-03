import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

// Transfers between warehouses (sql/033, documentation/plans/INVENTORY_TRANSFERS_PLAN.md). The database functions enforce the
// rules and are tested in sql/tests/029_inventory_transfers.sql; these tests cover the API layer in front of them.

const env = { APP_ENV: 'test', ALLOWED_ORIGINS: 'http://localhost:5173' };
const ID = '11111111-1111-4111-8111-111111111111';

const routes: [string, string][] = [
  ['GET', '/v1/inventory/transfers'],
  ['GET', `/v1/inventory/transfers/${ID}`],
  ['GET', '/v1/inventory/in-transit'],
  ['POST', '/v1/inventory/transfers'],
  ['POST', `/v1/inventory/transfers/${ID}/approve`],
  ['POST', `/v1/inventory/transfers/${ID}/reject`],
  ['POST', `/v1/inventory/transfers/${ID}/dispatch`],
  ['POST', `/v1/inventory/transfers/${ID}/receive`],
  ['POST', `/v1/inventory/transfers/${ID}/cancel`],
];

describe('inventory transfers API', () => {
  it.each(routes)('%s %s needs a signed-in user', async (method, path) => {
    const res = await app.request(path, { method }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ success: false, code: 'unauthenticated' });
  });

  const source = readFileSync(join(__dirname, '../src/modules/inventory/routes.ts'), 'utf8');
  const transferSource = source.slice(source.indexOf('transfers between warehouses (sql/033)'));

  it('puts a permission check on every transfer route', () => {
    const declared = transferSource.match(/inventoryRoutes\.(get|post)\(/g) ?? [];
    const guarded =
      transferSource.match(
        /inventoryRoutes\.(get|post)\([^\n]*requirePermission\('inventory\.transfers\.(read|create|approve|dispatch|receive)'\)/g,
      ) ?? [];
    expect(declared.length).toBeGreaterThan(0);
    expect(guarded.length).toBe(declared.length);
  });

  it('reaches the stock only through the database functions', () => {
    for (const fn of [
      'inv_submit_transfer',
      'inv_decide_transfer',
      'inv_dispatch_transfer',
      'inv_receive_transfer',
      'inv_cancel_transfer',
      'inv_in_transit',
    ]) {
      expect(transferSource).toContain(`'${fn}'`);
    }
    expect(transferSource).not.toMatch(/\.from\('inv_stock_(moves|balances)'\)/);
    expect(transferSource).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it('asks for approval permission on approve and reject, never the create permission', () => {
    const loop = transferSource.slice(
      transferSource.indexOf('for (const [action, decision]'),
      transferSource.indexOf("'/transfers/:id/dispatch'"),
    );
    expect(loop).toContain("requirePermission('inventory.transfers.approve')");
    expect(loop).not.toContain("requirePermission('inventory.transfers.create')");
  });
});

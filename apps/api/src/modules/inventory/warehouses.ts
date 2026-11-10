import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { UUID_RE, idParam, orgOf, text } from './helpers';

export function registerWarehouseRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/warehouses', requirePermission('inventory.items.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('inv_warehouses')
      .select('id, code, name, branch_id')
      .eq('org_id', orgOf(c))
      .is('deleted_at', null)
      .order('code');
    if (error) throw error;
    return ok(
      c,
      (data ?? []).map((w: { id: string; code: string; name: string; branch_id: string | null }) => ({
        id: w.id,
        code: w.code,
        name: w.name,
        branchId: w.branch_id,
      })),
    );
  });

  // Put a warehouse in a branch (sql/050). Owners and admins; the database checks again.
  inventoryRoutes.put('/warehouses/:id/branch', requirePermission('core.branches.manage'), async (c) => {
    const branchId = text((await jsonBody(c)).branchId);
    if (!UUID_RE.test(branchId)) invalid('branchId is required');
    await callRpc<void>(userDb(c), 'inv_set_warehouse_branch', { p_warehouse_id: idParam(c), p_branch_id: branchId });
    return ok(c, { id: idParam(c), branchId });
  });

  inventoryRoutes.post('/warehouses', requirePermission('inventory.warehouses.manage'), async (c) => {
    const body = await jsonBody(c);
    const code = text(body.code);
    const name = text(body.name);
    if (!code || !name) invalid('Code and name are required');
    const id = await callRpc<string>(userDb(c), 'inv_create_warehouse', {
      p_code: code,
      p_name: name,
      p_name_ar: text(body.nameAr) || null,
    });
    return ok(c, { id, code, name }, 201);
  });
}

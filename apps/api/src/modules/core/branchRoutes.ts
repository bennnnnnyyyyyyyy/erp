import { Hono } from 'hono';
import type { Branch } from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// Branches inside one company (TREASURY_PLAN.md B1, sql/050). Every member can see them (they label warehouses and cash boxes);
// owners and admins change them, and the database checks that again.
export const branchRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');

branchRoutes.get('/', requirePermission('core.org.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('core_branches')
    .select('id, code, name, name_ar, active, tax_branch_id')
    .eq('org_id', c.var.tenant.orgId)
    .is('deleted_at', null)
    .order('code');
  if (error) throw error;
  return ok<Branch[]>(
    c,
    (data ?? []).map((b) => ({ id: b.id, code: b.code, name: b.name, nameAr: b.name_ar, active: b.active, taxBranchId: b.tax_branch_id })),
  );
});

function branchBody(b: Record<string, unknown>) {
  const code = text(b.code).toUpperCase();
  const name = text(b.name);
  const taxBranchId = text(b.taxBranchId);
  if (!/^[A-Z0-9-]{1,20}$/.test(code) || !name) invalid('A code (letters, digits, dash; up to 20) and a name are required');
  if (taxBranchId && !UUID_RE.test(taxBranchId)) invalid('Invalid tax branch');
  return {
    code,
    name,
    nameAr: text(b.nameAr) || null,
    active: b.active === undefined ? true : b.active === true,
    taxBranchId: taxBranchId || null,
  };
}

branchRoutes.post('/', requirePermission('core.branches.manage'), async (c) => {
  const b = branchBody(await jsonBody(c));
  const id = await callRpc<string>(userDb(c), 'core_save_branch', {
    p_id: null,
    p_code: b.code,
    p_name: b.name,
    p_name_ar: b.nameAr,
    p_active: b.active,
    p_tax_branch_id: b.taxBranchId,
  });
  return ok(c, { id }, 201);
});

branchRoutes.patch('/:id', requirePermission('core.branches.manage'), async (c) => {
  const id = c.req.param('id');
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  const b = branchBody(await jsonBody(c));
  await callRpc<string>(userDb(c), 'core_save_branch', {
    p_id: id,
    p_code: b.code,
    p_name: b.name,
    p_name_ar: b.nameAr,
    p_active: b.active,
    p_tax_branch_id: b.taxBranchId,
  });
  return ok(c, { id });
});

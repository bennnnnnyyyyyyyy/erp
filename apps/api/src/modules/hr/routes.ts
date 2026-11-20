import { Hono } from 'hono';
import type { HrDirectory, HrSyncStatus, HrUnit } from '@erp/shared';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

// People: the staff directory read from the HR & payroll app (sql/102; documentation/plans/HR_APP_INTEGRATION_PLAN.md). Every member
// reads the directory (hr.people.read); owners and admins link employees to ERP members, map HR branches to ERP branches and ask
// for a sync (hr.people.manage, core.integrations.manage). Every call uses the caller's own sign-in; the database checks the role
// again and audits. The copies themselves are written only by the sync job.
export const hrRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['active', 'on_leave', 'terminated'];
const ID_RE = /^[\w.:-]{1,64}$/;

const uuidParam = (v: string | undefined): string => {
  if (!v || !UUID_RE.test(v)) invalid('Invalid id');
  return v;
};

hrRoutes.get('/employees', requirePermission('hr.people.read'), async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 80);
  const status = c.req.query('status') || null;
  const branch = c.req.query('branch') || null;
  const department = c.req.query('department') || null;
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(c.req.query('pageSize') ?? '50', 10) || 50));
  if (status && !STATUSES.includes(status)) invalid('Unknown status');
  if ((branch && !ID_RE.test(branch)) || (department && !ID_RE.test(department))) invalid('Invalid branch or department');
  const d = await callRpc<HrDirectory>(userDb(c), 'hr_directory', {
    p_q: q || null,
    p_branch: branch,
    p_department: department,
    p_status: status,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  return ok<HrDirectory>(c, { total: Number(d.total), rows: d.rows ?? [], details: Boolean(d.details) });
});

hrRoutes.get('/units', requirePermission('hr.people.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('hr_units')
    .select('id, kind, external_id, code, name, name_ar, branch_external_id, core_branch_id, active')
    .eq('org_id', c.var.tenant.orgId)
    .is('deleted_at', null)
    .order('kind')
    .order('name');
  if (error) throw error;
  return ok<HrUnit[]>(
    c,
    (data ?? []).map((u) => ({
      id: u.id,
      kind: u.kind,
      externalId: u.external_id,
      code: u.code,
      name: u.name,
      nameAr: u.name_ar,
      branchExternalId: u.branch_external_id,
      coreBranchId: u.core_branch_id,
      active: u.active,
    })),
  );
});

hrRoutes.put('/employees/:id/link', requirePermission('hr.people.manage'), async (c) => {
  const id = uuidParam(c.req.param('id'));
  const userId = (await jsonBody(c)).userId;
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) invalid('userId is required');
  await callRpc<void>(userDb(c), 'hr_link_employee', { p_employee: id, p_user: userId });
  return ok(c, { id, userId });
});

hrRoutes.delete('/employees/:id/link', requirePermission('hr.people.manage'), async (c) => {
  const id = uuidParam(c.req.param('id'));
  await callRpc<void>(userDb(c), 'hr_unlink_employee', { p_employee: id });
  return ok(c, { id, userId: null });
});

hrRoutes.put('/units/:id/branch', requirePermission('hr.people.manage'), async (c) => {
  const id = uuidParam(c.req.param('id'));
  const coreBranchId = (await jsonBody(c)).coreBranchId;
  if (coreBranchId !== null && (typeof coreBranchId !== 'string' || !UUID_RE.test(coreBranchId)))
    invalid('coreBranchId must be an id or null');
  await callRpc<void>(userDb(c), 'hr_map_branch', { p_unit: id, p_core_branch: coreBranchId });
  return ok(c, { id, coreBranchId });
});

hrRoutes.get('/status', requirePermission('hr.people.manage'), async (c) => {
  const { data, error } = await userDb(c)
    .from('hr_sync_state')
    .select('requested_at, last_finished_at, last_result, last_error, last_webhook_at, counts')
    .eq('org_id', c.var.tenant.orgId)
    .maybeSingle();
  if (error) throw error;
  return ok<HrSyncStatus>(
    c,
    data
      ? {
          requestedAt: data.requested_at,
          lastFinishedAt: data.last_finished_at,
          lastResult: data.last_result,
          lastError: data.last_error,
          lastWebhookAt: data.last_webhook_at,
          counts: (data.counts ?? {}) as Record<string, number>,
        }
      : null,
  );
});

// "Sync now": the next 5-minute run reads this company first.
hrRoutes.post('/sync', requirePermission('core.integrations.manage'), async (c) => {
  const at = await callRpc<string>(userDb(c), 'hr_request_sync');
  return ok(c, { requestedAt: at }, 202);
});

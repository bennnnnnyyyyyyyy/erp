import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { idParam, orgOf, text } from './helpers';

type RequestRow = {
  id: string;
  number: string;
  requester_id: string;
  warehouse_id: string;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  issued_at: string | null;
  created_at: string;
};

async function loadRequests(c: Context<AppEnv>, filter?: { id: string }) {
  const client = userDb(c);
  let q = client
    .from('inv_requests')
    .select('id, number, requester_id, warehouse_id, reason, status, decided_by, decided_at, decision_comment, issued_at, created_at')
    .eq('org_id', orgOf(c))
    .order('created_at', { ascending: false })
    .limit(200);
  if (filter) q = q.eq('id', filter.id);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as RequestRow[];
  const ids = rows.map((r) => r.id);
  const lines = new Map<string, { itemId: string; qty: number }[]>();
  if (ids.length > 0) {
    const { data: l, error: lErr } = await client
      .from('inv_request_lines')
      .select('request_id, item_id, qty')
      .eq('org_id', orgOf(c))
      .in('request_id', ids);
    if (lErr) throw lErr;
    for (const row of (l ?? []) as { request_id: string; item_id: string; qty: number }[]) {
      lines.set(row.request_id, [...(lines.get(row.request_id) ?? []), { itemId: row.item_id, qty: Number(row.qty) }]);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    requesterId: r.requester_id,
    requesterName: '', // the web app resolves names from the members list
    warehouseId: r.warehouse_id,
    reason: r.reason,
    status: r.status,
    lines: lines.get(r.id) ?? [],
    createdAt: r.created_at,
    decidedBy: r.decided_by,
    decisionComment: r.decision_comment,
    decidedAt: r.decided_at,
    issuedAt: r.issued_at,
    source: null,
  }));
}

async function oneRequest(c: Context<AppEnv>, id: string) {
  const [row] = await loadRequests(c, { id });
  if (!row) throw new HttpError(404, 'Request not found', 'not_found');
  return row;
}

export function registerRequestRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/requests', requirePermission('inventory.items.read'), async (c) => ok(c, await loadRequests(c)));
  inventoryRoutes.get('/requests/:id', requirePermission('inventory.items.read'), async (c) => ok(c, await oneRequest(c, idParam(c))));

  inventoryRoutes.get('/approval-policies', requirePermission('inventory.items.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('inv_approval_policies')
      .select('id, warehouse_id, min_total_qty, required_approvals')
      .eq('org_id', orgOf(c))
      .order('min_total_qty', { ascending: true });
    if (error) throw error;
    return ok(
      c,
      ((data ?? []) as { id: string; warehouse_id: string | null; min_total_qty: number; required_approvals: number }[]).map((p) => ({
        id: p.id,
        warehouseId: p.warehouse_id,
        minTotalQty: Number(p.min_total_qty),
        requiredApprovals: Number(p.required_approvals),
      })),
    );
  });

  inventoryRoutes.post('/approval-policies', requirePermission('inventory.approval_policies.manage'), async (c) => {
    const body = await jsonBody(c);
    const minTotalQty = Number(body.minTotalQty);
    const requiredApprovals = Number(body.requiredApprovals);
    const warehouseId = body.warehouseId ? text(body.warehouseId) : null;
    if (
      !Number.isFinite(minTotalQty) ||
      minTotalQty < 0 ||
      !Number.isInteger(requiredApprovals) ||
      requiredApprovals < 1 ||
      requiredApprovals > 3
    ) {
      invalid('Enter a quantity threshold and between 1 and 3 approvals');
    }
    await callRpc<string>(userDb(c), 'inv_set_approval_policy', {
      p_warehouse_id: warehouseId,
      p_min_total_qty: minTotalQty,
      p_required: requiredApprovals,
    });
    const { data, error } = await userDb(c)
      .from('inv_approval_policies')
      .select('id, warehouse_id, min_total_qty, required_approvals')
      .eq('org_id', orgOf(c))
      .order('min_total_qty');
    if (error) throw error;
    return ok(
      c,
      ((data ?? []) as { id: string; warehouse_id: string | null; min_total_qty: number; required_approvals: number }[]).map((p) => ({
        id: p.id,
        warehouseId: p.warehouse_id,
        minTotalQty: Number(p.min_total_qty),
        requiredApprovals: Number(p.required_approvals),
      })),
    );
  });

  inventoryRoutes.delete('/approval-policies/:id', requirePermission('inventory.approval_policies.manage'), async (c) => {
    await callRpc<void>(userDb(c), 'inv_remove_approval_policy', { p_policy_id: idParam(c) });
    return ok(c, { removed: true });
  });

  inventoryRoutes.post('/requests', requirePermission('inventory.request.create'), async (c) => {
    const body = await jsonBody(c);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const cleaned = lines
      .map((l) => ({ itemId: text((l as Record<string, unknown>)?.itemId), qty: Number((l as Record<string, unknown>)?.qty) }))
      .filter((l) => l.itemId && Number.isFinite(l.qty) && l.qty > 0);
    if (cleaned.length === 0) invalid('Add at least one item with a quantity');
    const made = await callRpc<{ id: string; number: string }>(userDb(c), 'inv_submit_request', {
      p_warehouse_id: text(body.warehouseId),
      p_reason: text(body.reason),
      p_lines: cleaned,
    });
    return ok(c, await oneRequest(c, made.id), 201);
  });

  for (const [action, decision] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ] as const) {
    inventoryRoutes.post(`/requests/:id/${action}`, requirePermission('inventory.request.approve'), async (c) => {
      const id = idParam(c);
      const body = await c.req.json().catch(() => ({}));
      await callRpc<void>(userDb(c), 'inv_decide_request', {
        p_request_id: id,
        p_decision: decision,
        p_comment: text((body as Record<string, unknown>).comment) || null,
        p_channel: 'app',
      });
      return ok(c, await oneRequest(c, id));
    });
  }

  inventoryRoutes.post('/requests/:id/issue', requirePermission('inventory.stock.issue'), async (c) => {
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'inv_post_issue', { p_request_id: id });
    return ok(c, await oneRequest(c, id));
  });

  inventoryRoutes.post('/requests/:id/cancel', requirePermission('inventory.request.create'), async (c) => {
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'inv_cancel_request', { p_request_id: id });
    return ok(c, await oneRequest(c, id));
  });
}

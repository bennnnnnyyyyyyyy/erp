import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { UUID_RE, idParam, orgOf, text } from './helpers';

// ------------------------------------------------------------------ stock counts (sql/042)
// A count is an adjustment of many lines, so it uses the adjustment permissions: members count, owners and admins approve.

type CountRow = {
  id: string;
  number: string;
  warehouse_id: string;
  note: string | null;
  status: string;
  requester_id: string;
  submitted_by: string | null;
  submitted_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
};
type CountLineRow = { count_id: string; item_id: string; expected_qty: number; counted_qty: number | null; counted_at: string | null };

async function loadCounts(c: Context<AppEnv>, id?: string) {
  let q = userDb(c)
    .from('inv_counts')
    .select(
      'id, number, warehouse_id, note, status, requester_id, submitted_by, submitted_at, decided_by, decided_at, decision_comment, created_at',
    )
    .eq('org_id', orgOf(c))
    .order('created_at', { ascending: false })
    .limit(200);
  if (id) q = q.eq('id', id);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as CountRow[];
  const lines = new Map<string, CountLineRow[]>();
  if (id && rows.length) {
    const { data: ls, error: le } = await userDb(c)
      .from('inv_count_lines')
      .select('count_id, item_id, expected_qty, counted_qty, counted_at')
      .eq('org_id', orgOf(c))
      .eq('count_id', id)
      .order('item_id');
    if (le) throw le;
    lines.set(id, (ls ?? []) as CountLineRow[]);
  }
  // Blind counts (sql/066): while a count is being counted, people other than owners and admins do not get the expected quantity.
  const t = c.var.tenant;
  const blindFor = (status: string) => t.blindCounts && status === 'counting' && t.role !== 'owner' && t.role !== 'admin';
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    warehouseId: r.warehouse_id,
    blind: blindFor(r.status),
    note: r.note,
    status: r.status,
    requesterId: r.requester_id,
    submittedBy: r.submitted_by,
    submittedAt: r.submitted_at,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionComment: r.decision_comment,
    createdAt: r.created_at,
    lines: id
      ? (lines.get(r.id) ?? []).map((l) => ({
          itemId: l.item_id,
          expectedQty: blindFor(r.status) ? null : Number(l.expected_qty),
          countedQty: l.counted_qty === null ? null : Number(l.counted_qty),
          difference: l.counted_qty === null || blindFor(r.status) ? null : Number(l.counted_qty) - Number(l.expected_qty),
          countedAt: l.counted_at,
        }))
      : undefined,
  }));
}

async function oneCount(c: Context<AppEnv>, id: string) {
  const [count] = await loadCounts(c, id);
  if (!count) throw new HttpError(404, 'Count not found', 'not_found');
  return count;
}

export function registerCountRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/counts', requirePermission('inventory.adjustments.read'), async (c) => ok(c, await loadCounts(c)));
  inventoryRoutes.get('/counts/:id', requirePermission('inventory.adjustments.read'), async (c) => ok(c, await oneCount(c, idParam(c))));

  inventoryRoutes.post('/counts', requirePermission('inventory.adjustments.create'), async (c) => {
    const body = await jsonBody(c);
    const warehouseId = text(body.warehouseId);
    if (!UUID_RE.test(warehouseId)) invalid('A warehouse is required');
    let itemIds: string[] | null = null;
    if (body.itemIds !== undefined && body.itemIds !== null) {
      if (!Array.isArray(body.itemIds) || body.itemIds.some((v) => typeof v !== 'string' || !UUID_RE.test(v)))
        invalid('itemIds must be a list of item ids');
      itemIds = body.itemIds as string[];
    }
    const made = await callRpc<{ id: string }>(userDb(c), 'inv_start_count', {
      p_warehouse_id: warehouseId,
      p_item_ids: itemIds,
      p_note: text(body.note) || null,
    });
    return ok(c, await oneCount(c, made.id), 201);
  });

  // Enter or clear one counted quantity: { itemId, countedQty: number | null }.
  inventoryRoutes.put('/counts/:id/lines', requirePermission('inventory.adjustments.create'), async (c) => {
    const id = idParam(c);
    const body = await jsonBody(c);
    const itemId = text(body.itemId);
    const counted = body.countedQty === null ? null : Number(body.countedQty);
    if (!UUID_RE.test(itemId) || (counted !== null && (!Number.isFinite(counted) || counted < 0)))
      invalid('An item and a counted quantity of zero or more (or null to clear) are required');
    await callRpc<void>(userDb(c), 'inv_set_count_line', { p_count_id: id, p_item_id: itemId, p_counted_qty: counted });
    return ok(c, await oneCount(c, id));
  });

  inventoryRoutes.post('/counts/:id/submit', requirePermission('inventory.adjustments.create'), async (c) => {
    const id = idParam(c);
    await callRpc<unknown>(userDb(c), 'inv_submit_count', { p_count_id: id });
    return ok(c, await oneCount(c, id));
  });

  for (const [action, decision] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ] as const) {
    inventoryRoutes.post(`/counts/:id/${action}`, requirePermission('inventory.adjustments.approve'), async (c) => {
      const id = idParam(c);
      const body = await c.req.json().catch(() => ({}));
      await callRpc<unknown>(userDb(c), 'inv_decide_count', {
        p_count_id: id,
        p_decision: decision,
        p_comment: text((body as Record<string, unknown>).comment) || null,
        p_channel: 'app',
      });
      return ok(c, await oneCount(c, id));
    });
  }

  inventoryRoutes.post('/counts/:id/cancel', requirePermission('inventory.adjustments.create'), async (c) => {
    const id = idParam(c);
    const body = await c.req.json().catch(() => ({}));
    await callRpc<void>(userDb(c), 'inv_cancel_count', {
      p_count_id: id,
      p_reason: text((body as Record<string, unknown>).reason) || null,
    });
    return ok(c, await oneCount(c, id));
  });
}

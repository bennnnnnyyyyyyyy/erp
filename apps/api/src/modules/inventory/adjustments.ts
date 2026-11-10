import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { idParam, orgOf, text } from './helpers';

type AdjustmentRow = {
  id: string;
  number: string;
  item_id: string;
  warehouse_id: string;
  counted_qty: number;
  expected_qty: number;
  delta: number;
  reason: string;
  status: string;
  requester_id: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
};

const toAdjustment = (a: AdjustmentRow) => ({
  id: a.id,
  number: a.number,
  itemId: a.item_id,
  warehouseId: a.warehouse_id,
  countedQty: Number(a.counted_qty),
  expectedQty: Number(a.expected_qty),
  delta: Number(a.delta),
  reason: a.reason,
  status: a.status,
  requesterId: a.requester_id,
  decidedBy: a.decided_by,
  decidedAt: a.decided_at,
  decisionComment: a.decision_comment,
  createdAt: a.created_at,
});

async function loadAdjustments(c: Context<AppEnv>, id?: string) {
  let q = userDb(c)
    .from('inv_adjustments')
    .select(
      'id, number, item_id, warehouse_id, counted_qty, expected_qty, delta, reason, status, requester_id, decided_by, decided_at, decision_comment, created_at',
    )
    .eq('org_id', orgOf(c))
    .order('created_at', { ascending: false })
    .limit(200);
  if (id) q = q.eq('id', id);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as AdjustmentRow[]).map(toAdjustment);
}

export function registerAdjustmentRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/adjustments', requirePermission('inventory.adjustments.read'), async (c) => ok(c, await loadAdjustments(c)));
  inventoryRoutes.get('/adjustments/:id', requirePermission('inventory.adjustments.read'), async (c) => {
    const [adjustment] = await loadAdjustments(c, idParam(c));
    if (!adjustment) throw new HttpError(404, 'Adjustment not found', 'not_found');
    return ok(c, adjustment);
  });

  inventoryRoutes.post('/adjustments', requirePermission('inventory.adjustments.create'), async (c) => {
    const body = await jsonBody(c);
    const itemId = text(body.itemId);
    const warehouseId = text(body.warehouseId);
    const countedQty = Number(body.countedQty);
    const reason = text(body.reason);
    if (!itemId || !warehouseId || !Number.isFinite(countedQty) || countedQty < 0 || !reason)
      invalid('Item, warehouse, counted quantity and reason are required');
    const made = await callRpc<{ id: string; number: string }>(userDb(c), 'inv_submit_adjustment', {
      p_item_id: itemId,
      p_warehouse_id: warehouseId,
      p_counted_qty: countedQty,
      p_reason: reason,
    });
    const [adjustment] = await loadAdjustments(c, made.id);
    return ok(c, adjustment, 201);
  });

  for (const [action, decision] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ] as const) {
    inventoryRoutes.post(`/adjustments/:id/${action}`, requirePermission('inventory.adjustments.approve'), async (c) => {
      const body = await c.req.json().catch(() => ({}));
      await callRpc<void>(userDb(c), 'inv_decide_adjustment', {
        p_adjustment_id: idParam(c),
        p_decision: decision,
        p_comment: text((body as Record<string, unknown>).comment) || null,
        p_channel: 'app',
      });
      const [adjustment] = await loadAdjustments(c, c.req.param('id'));
      return ok(c, adjustment);
    });
  }

  inventoryRoutes.post('/adjustments/:id/cancel', requirePermission('inventory.adjustments.create'), async (c) => {
    await callRpc<void>(userDb(c), 'inv_cancel_adjustment', { p_adjustment_id: idParam(c) });
    const [adjustment] = await loadAdjustments(c, c.req.param('id'));
    return ok(c, adjustment);
  });
}

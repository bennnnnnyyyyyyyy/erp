import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

// Inventory slice 1 (documentation/plans/INVENTORY_PLAN.md). Reads use the signed-in user's client (row level
// security) and always filter by the caller's organization, because a user can belong to several. Every change
// is one database function from sql/006, which checks role and module and writes its audit row itself (ADR-0003).
// Response shapes are the ones the web screens already use.

export const inventoryRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;

function idParam(c: Context<AppEnv>): string {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

// ------------------------------------------------------------------ shapes

type ItemRow = { id: string; sku: string; name: string; name_ar: string | null; uom: string; reorder_level: number | null; tracks_batches?: boolean; storage_condition_id?: string | null };
const toItem = (r: ItemRow) => ({ id: r.id, sku: r.sku, name: r.name, nameAr: r.name_ar ?? '', uom: r.uom, reorderLevel: r.reorder_level === null ? null : Number(r.reorder_level), tracksBatches: Boolean(r.tracks_batches), storageConditionId: r.storage_condition_id ?? null });

type RequestRow = {
  id: string; number: string; requester_id: string; warehouse_id: string; reason: string; status: string;
  decided_by: string | null; decided_at: string | null; decision_comment: string | null; issued_at: string | null; created_at: string;
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
    const { data: l, error: lErr } = await client.from('inv_request_lines').select('request_id, item_id, qty').eq('org_id', orgOf(c)).in('request_id', ids);
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

// ------------------------------------------------------------------ reads

inventoryRoutes.get('/warehouses', requirePermission('inventory.items.read'), async (c) => {
  const { data, error } = await userDb(c).from('inv_warehouses').select('id, code, name').eq('org_id', orgOf(c)).is('deleted_at', null).order('code');
  if (error) throw error;
  return ok(c, (data ?? []).map((w: { id: string; code: string; name: string }) => ({ id: w.id, code: w.code, name: w.name })));
});

inventoryRoutes.get('/items', requirePermission('inventory.items.read'), async (c) => {
  const { data, error } = await userDb(c).from('inv_items').select('id, sku, name, name_ar, uom, reorder_level, tracks_batches, storage_condition_id').eq('org_id', orgOf(c)).is('deleted_at', null).order('sku');
  if (error) throw error;
  return ok(c, ((data ?? []) as ItemRow[]).map(toItem));
});

inventoryRoutes.get('/stock', requirePermission('inventory.items.read'), async (c) => {
  const { data, error } = await userDb(c).from('inv_stock_balances').select('item_id, warehouse_id, on_hand, reserved').eq('org_id', orgOf(c));
  if (error) throw error;
  return ok(
    c,
    ((data ?? []) as { item_id: string; warehouse_id: string; on_hand: number; reserved: number }[]).map((s) => ({
      itemId: s.item_id,
      warehouseId: s.warehouse_id,
      onHand: Number(s.on_hand),
      reserved: Number(s.reserved),
      available: Number(s.on_hand) - Number(s.reserved),
    })),
  );
});

inventoryRoutes.get('/ledger', requirePermission('inventory.items.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('inv_stock_moves')
    .select('id, item_id, warehouse_id, qty, kind, request_id, ref, posted_by, posted_at')
    .eq('org_id', orgOf(c))
    .order('id', { ascending: false })
    .limit(500);
  if (error) throw error;
  return ok(
    c,
    ((data ?? []) as { id: number; item_id: string; warehouse_id: string; qty: number; kind: string; request_id: string | null; ref: string | null; posted_by: string; posted_at: string }[]).map((m) => ({
      id: m.id, itemId: m.item_id, warehouseId: m.warehouse_id, qty: Number(m.qty), kind: m.kind, requestId: m.request_id, ref: m.ref, postedBy: m.posted_by, postedAt: m.posted_at,
    })),
  );
});

inventoryRoutes.get('/requests', requirePermission('inventory.items.read'), async (c) => ok(c, await loadRequests(c)));
inventoryRoutes.get('/requests/:id', requirePermission('inventory.items.read'), async (c) => ok(c, await oneRequest(c, idParam(c))));

inventoryRoutes.get('/approval-policies', requirePermission('inventory.items.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('inv_approval_policies')
    .select('id, warehouse_id, min_total_qty, required_approvals')
    .eq('org_id', orgOf(c))
    .order('min_total_qty', { ascending: true });
  if (error) throw error;
  return ok(c, ((data ?? []) as { id: string; warehouse_id: string | null; min_total_qty: number; required_approvals: number }[]).map((p) => ({
    id: p.id,
    warehouseId: p.warehouse_id,
    minTotalQty: Number(p.min_total_qty),
    requiredApprovals: Number(p.required_approvals),
  })));
});

type AdjustmentRow = {
  id: string; number: string; item_id: string; warehouse_id: string; counted_qty: number; expected_qty: number;
  delta: number; reason: string; status: string; requester_id: string; decided_by: string | null;
  decided_at: string | null; decision_comment: string | null; created_at: string;
};

const toAdjustment = (a: AdjustmentRow) => ({
  id: a.id, number: a.number, itemId: a.item_id, warehouseId: a.warehouse_id,
  countedQty: Number(a.counted_qty), expectedQty: Number(a.expected_qty), delta: Number(a.delta),
  reason: a.reason, status: a.status, requesterId: a.requester_id, decidedBy: a.decided_by,
  decidedAt: a.decided_at, decisionComment: a.decision_comment, createdAt: a.created_at,
});

async function loadAdjustments(c: Context<AppEnv>, id?: string) {
  let q = userDb(c).from('inv_adjustments')
    .select('id, number, item_id, warehouse_id, counted_qty, expected_qty, delta, reason, status, requester_id, decided_by, decided_at, decision_comment, created_at')
    .eq('org_id', orgOf(c)).order('created_at', { ascending: false }).limit(200);
  if (id) q = q.eq('id', id);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as AdjustmentRow[]).map(toAdjustment);
}

inventoryRoutes.get('/adjustments', requirePermission('inventory.adjustments.read'), async (c) => ok(c, await loadAdjustments(c)));
inventoryRoutes.get('/adjustments/:id', requirePermission('inventory.adjustments.read'), async (c) => {
  const [adjustment] = await loadAdjustments(c, idParam(c));
  if (!adjustment) throw new HttpError(404, 'Adjustment not found', 'not_found');
  return ok(c, adjustment);
});

// ------------------------------------------------------------------ changes (one database function each)

inventoryRoutes.post('/warehouses', requirePermission('inventory.warehouses.manage'), async (c) => {
  const body = await jsonBody(c);
  const code = text(body.code);
  const name = text(body.name);
  if (!code || !name) invalid('Code and name are required');
  const id = await callRpc<string>(userDb(c), 'inv_create_warehouse', { p_code: code, p_name: name, p_name_ar: text(body.nameAr) || null });
  return ok(c, { id, code, name }, 201);
});

inventoryRoutes.post('/items', requirePermission('inventory.items.manage'), async (c) => {
  const body = await jsonBody(c);
  const sku = text(body.sku);
  const name = text(body.name);
  if (!sku || !name) invalid('SKU and name are required');
  const opening = Number(body.openingQty ?? 0);
  if (!Number.isFinite(opening) || opening < 0) invalid('Opening stock must be zero or more');
  const id = await callRpc<string>(userDb(c), 'inv_create_item', {
    p_sku: sku,
    p_name: name,
    p_name_ar: text(body.nameAr) || null,
    p_uom: text(body.uom) || 'piece',
    p_opening_qty: opening,
    p_warehouse_id: text(body.warehouseId) || null,
  });
  return ok(c, toItem({ id, sku: sku.toUpperCase(), name, name_ar: text(body.nameAr) || null, uom: text(body.uom) || 'piece', reorder_level: null }), 201);
});

inventoryRoutes.post('/items/:id/reorder-level', requirePermission('inventory.reorder.manage'), async (c) => {
  const id = idParam(c);
  const body = await jsonBody(c);
  const raw = body.level;
  const level = raw === null ? null : Number(raw);
  if (raw === undefined || (level !== null && (!Number.isFinite(level) || level < 0))) invalid('Reorder level must be zero or more, or empty');
  await callRpc<void>(userDb(c), 'inv_set_reorder_level', { p_item_id: id, p_level: level });
  const { data, error } = await userDb(c).from('inv_items').select('id, sku, name, name_ar, uom, reorder_level, tracks_batches, storage_condition_id').eq('org_id', orgOf(c)).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Item not found', 'not_found');
  return ok(c, toItem(data as ItemRow));
});

inventoryRoutes.post('/approval-policies', requirePermission('inventory.approval_policies.manage'), async (c) => {
  const body = await jsonBody(c);
  const minTotalQty = Number(body.minTotalQty);
  const requiredApprovals = Number(body.requiredApprovals);
  const warehouseId = body.warehouseId ? text(body.warehouseId) : null;
  if (!Number.isFinite(minTotalQty) || minTotalQty < 0 || !Number.isInteger(requiredApprovals) || requiredApprovals < 1 || requiredApprovals > 3) {
    invalid('Enter a quantity threshold and between 1 and 3 approvals');
  }
  await callRpc<string>(userDb(c), 'inv_set_approval_policy', {
    p_warehouse_id: warehouseId,
    p_min_total_qty: minTotalQty,
    p_required: requiredApprovals,
  });
  const { data, error } = await userDb(c).from('inv_approval_policies').select('id, warehouse_id, min_total_qty, required_approvals').eq('org_id', orgOf(c)).order('min_total_qty');
  if (error) throw error;
  return ok(c, ((data ?? []) as { id: string; warehouse_id: string | null; min_total_qty: number; required_approvals: number }[]).map((p) => ({ id: p.id, warehouseId: p.warehouse_id, minTotalQty: Number(p.min_total_qty), requiredApprovals: Number(p.required_approvals) })));
});

inventoryRoutes.delete('/approval-policies/:id', requirePermission('inventory.approval_policies.manage'), async (c) => {
  await callRpc<void>(userDb(c), 'inv_remove_approval_policy', { p_policy_id: idParam(c) });
  return ok(c, { removed: true });
});

inventoryRoutes.post('/adjustments', requirePermission('inventory.adjustments.create'), async (c) => {
  const body = await jsonBody(c);
  const itemId = text(body.itemId);
  const warehouseId = text(body.warehouseId);
  const countedQty = Number(body.countedQty);
  const reason = text(body.reason);
  if (!itemId || !warehouseId || !Number.isFinite(countedQty) || countedQty < 0 || !reason) invalid('Item, warehouse, counted quantity and reason are required');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'inv_submit_adjustment', {
    p_item_id: itemId, p_warehouse_id: warehouseId, p_counted_qty: countedQty, p_reason: reason,
  });
  const [adjustment] = await loadAdjustments(c, made.id);
  return ok(c, adjustment, 201);
});

for (const [action, decision] of [['approve', 'approved'], ['reject', 'rejected']] as const) {
  inventoryRoutes.post(`/adjustments/:id/${action}`, requirePermission('inventory.adjustments.approve'), async (c) => {
    const body = await c.req.json().catch(() => ({}));
    await callRpc<void>(userDb(c), 'inv_decide_adjustment', {
      p_adjustment_id: idParam(c), p_decision: decision,
      p_comment: text((body as Record<string, unknown>).comment) || null, p_channel: 'app',
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

for (const [action, decision] of [['approve', 'approved'], ['reject', 'rejected']] as const) {
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

// ------------------------------------------------------------------ batches, expiry, storage (sql/026)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

inventoryRoutes.get('/storage-conditions', requirePermission('inventory.batches.read'), async (c) => {
  const { data, error } = await userDb(c).from('inv_storage_conditions').select('id, name, min_temp_c, max_temp_c').eq('org_id', orgOf(c)).order('name');
  if (error) throw error;
  return ok(c, (data ?? []).map((s) => ({ id: s.id, name: s.name, minTempC: s.min_temp_c === null ? null : Number(s.min_temp_c), maxTempC: s.max_temp_c === null ? null : Number(s.max_temp_c) })));
});

inventoryRoutes.post('/storage-conditions', requirePermission('inventory.batches.manage'), async (c) => {
  const b = await jsonBody(c);
  const name = text(b.name);
  const min = b.minTempC === null || b.minTempC === undefined || b.minTempC === '' ? null : Number(b.minTempC);
  const max = b.maxTempC === null || b.maxTempC === undefined || b.maxTempC === '' ? null : Number(b.maxTempC);
  if (!name || (min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) invalid('A name is required; temperatures must be numbers');
  const id = await callRpc<string>(userDb(c), 'inv_create_storage_condition', { p_name: name, p_min_temp_c: min, p_max_temp_c: max });
  return ok(c, { id }, 201);
});

inventoryRoutes.post('/warehouses/:id/storage', requirePermission('inventory.batches.manage'), async (c) => {
  const id = idParam(c);
  const cond = text((await jsonBody(c)).conditionId);
  if (cond && !UUID_RE.test(cond)) invalid('Invalid condition');
  await callRpc(userDb(c), 'inv_set_warehouse_storage', { p_warehouse_id: id, p_condition_id: cond || null });
  return ok(c, { id });
});

inventoryRoutes.post('/items/:id/batching', requirePermission('inventory.batches.manage'), async (c) => {
  const id = idParam(c);
  const b = await jsonBody(c);
  const cond = text(b.conditionId);
  if (typeof b.tracks !== 'boolean' || (cond && !UUID_RE.test(cond))) invalid('tracks (true/false) is required');
  await callRpc(userDb(c), 'inv_set_item_batching', { p_item_id: id, p_tracks: b.tracks, p_condition_id: cond || null });
  return ok(c, { id });
});

inventoryRoutes.get('/batches', requirePermission('inventory.batches.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('inv_batches')
    .select('id, item_id, batch_no, mfg_date, expiry_date, status, supplier_id, inv_batch_balances(warehouse_id, qty)')
    .eq('org_id', orgOf(c))
    .neq('batch_no', 'UNBATCHED')
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return ok(c, (data ?? []).map((b) => ({
    id: b.id, itemId: b.item_id, batchNo: b.batch_no, mfgDate: b.mfg_date, expiryDate: b.expiry_date, status: b.status, supplierId: b.supplier_id,
    stock: ((b.inv_batch_balances ?? []) as { warehouse_id: string; qty: number }[]).map((s) => ({ warehouseId: s.warehouse_id, qty: Number(s.qty) })),
  })));
});

inventoryRoutes.post('/batches', requirePermission('inventory.batches.receive'), async (c) => {
  const b = await jsonBody(c);
  const itemId = text(b.itemId), warehouseId = text(b.warehouseId), batchNo = text(b.batchNo);
  const qty = Number(b.qty), mfg = text(b.mfgDate), exp = text(b.expiryDate), supplier = text(b.supplierId);
  if (!UUID_RE.test(itemId) || !UUID_RE.test(warehouseId) || !batchNo || !Number.isFinite(qty) || qty <= 0 || (mfg && !DATE_RE.test(mfg)) || (exp && !DATE_RE.test(exp)) || (supplier && !UUID_RE.test(supplier))) {
    invalid('Item, warehouse, batch number and a quantity above zero are required');
  }
  const id = await callRpc<string>(userDb(c), 'inv_receive_batch', { p_item_id: itemId, p_warehouse_id: warehouseId, p_qty: qty, p_batch_no: batchNo, p_mfg_date: mfg || null, p_expiry_date: exp || null, p_supplier_id: supplier || null });
  return ok(c, { id }, 201);
});

inventoryRoutes.post('/batches/:id/status', requirePermission('inventory.batches.manage'), async (c) => {
  const id = idParam(c);
  const b = await jsonBody(c);
  const status = text(b.status);
  if (status !== 'available' && status !== 'quarantined') invalid('Status must be available or quarantined');
  await callRpc(userDb(c), 'inv_set_batch_status', { p_batch_id: id, p_status: status, p_note: text(b.note) || null });
  return ok(c, { id, status });
});

inventoryRoutes.get('/expiry', requirePermission('inventory.batches.read'), async (c) => {
  const days = Math.min(Math.max(Math.trunc(Number(c.req.query('days') ?? 90)) || 90, 0), 3650);
  const rows = await callRpc<{ batch_id: string; item_id: string; sku: string; name: string; batch_no: string; warehouse_id: string; qty: number; expiry_date: string; days_left: number; status: string }[]>(userDb(c), 'inv_expiry_report', { p_days: days });
  return ok(c, rows.map((r) => ({ batchId: r.batch_id, itemId: r.item_id, sku: r.sku, name: r.name, batchNo: r.batch_no, warehouseId: r.warehouse_id, qty: Number(r.qty), expiryDate: r.expiry_date, daysLeft: r.days_left, status: r.status })));
});
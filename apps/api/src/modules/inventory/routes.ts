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

type ItemRow = { id: string; sku: string; name: string; name_ar: string | null; uom: string };
const toItem = (r: ItemRow) => ({ id: r.id, sku: r.sku, name: r.name, nameAr: r.name_ar ?? '', uom: r.uom });

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
  const { data, error } = await userDb(c).from('inv_items').select('id, sku, name, name_ar, uom').eq('org_id', orgOf(c)).is('deleted_at', null).order('sku');
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
  return ok(c, toItem({ id, sku: sku.toUpperCase(), name, name_ar: text(body.nameAr) || null, uom: text(body.uom) || 'piece' }), 201);
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

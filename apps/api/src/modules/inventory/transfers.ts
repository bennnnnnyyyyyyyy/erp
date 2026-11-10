import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { UUID_RE, idParam, orgOf, text } from './helpers';

// ------------------------------------------------------------------ transfers between warehouses (sql/033)
// documentation/plans/INVENTORY_TRANSFERS_PLAN.md. Request, approve or reject, dispatch (stock goes in transit), receive, cancel.
// Each change is one database function that checks role, module and state and writes its audit row itself.

type TransferRow = {
  id: string;
  number: string;
  requester_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  reason: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  received_by: string | null;
  received_at: string | null;
  created_at: string;
};

async function loadTransfers(c: Context<AppEnv>, id?: string) {
  const client = userDb(c);
  let q = client
    .from('inv_transfers')
    .select(
      'id, number, requester_id, from_warehouse_id, to_warehouse_id, reason, status, decided_by, decided_at, decision_comment, dispatched_by, dispatched_at, received_by, received_at, created_at',
    )
    .eq('org_id', orgOf(c))
    .order('created_at', { ascending: false })
    .limit(200);
  if (id) q = q.eq('id', id);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as TransferRow[];
  const ids = rows.map((r) => r.id);
  const lines = new Map<string, { itemId: string; qty: number }[]>();
  const batches = new Map<string, { itemId: string; batchId: string; batchNo: string; expiryDate: string | null; qty: number }[]>();
  const approvals = new Map<
    string,
    { approverId: string; decision: string; comment: string | null; channel: string; decidedAt: string }[]
  >();
  if (ids.length > 0) {
    const org = orgOf(c);
    const [l, b, a] = await Promise.all([
      client.from('inv_transfer_lines').select('transfer_id, item_id, qty').eq('org_id', org).in('transfer_id', ids),
      client.from('inv_transfer_batches').select('transfer_id, item_id, batch_id, qty').eq('org_id', org).in('transfer_id', ids),
      client
        .from('inv_transfer_approvals')
        .select('transfer_id, approver_id, decision, comment, channel, decided_at')
        .eq('org_id', org)
        .in('transfer_id', ids)
        .order('decided_at'),
    ]);
    if (l.error) throw l.error;
    if (b.error) throw b.error;
    if (a.error) throw a.error;
    for (const row of (l.data ?? []) as { transfer_id: string; item_id: string; qty: number }[]) {
      lines.set(row.transfer_id, [...(lines.get(row.transfer_id) ?? []), { itemId: row.item_id, qty: Number(row.qty) }]);
    }
    const batchRows = (b.data ?? []) as { transfer_id: string; item_id: string; batch_id: string; qty: number }[];
    const info = new Map<string, { batch_no: string; expiry_date: string | null }>();
    if (batchRows.length > 0) {
      const { data: bi, error: biErr } = await client
        .from('inv_batches')
        .select('id, batch_no, expiry_date')
        .eq('org_id', org)
        .in('id', [...new Set(batchRows.map((r) => r.batch_id))]);
      if (biErr) throw biErr;
      for (const r of (bi ?? []) as { id: string; batch_no: string; expiry_date: string | null }[]) info.set(r.id, r);
    }
    for (const row of batchRows) {
      const meta = info.get(row.batch_id);
      batches.set(row.transfer_id, [
        ...(batches.get(row.transfer_id) ?? []),
        {
          itemId: row.item_id,
          batchId: row.batch_id,
          batchNo: meta?.batch_no ?? '',
          expiryDate: meta?.expiry_date ?? null,
          qty: Number(row.qty),
        },
      ]);
    }
    for (const row of (a.data ?? []) as {
      transfer_id: string;
      approver_id: string;
      decision: string;
      comment: string | null;
      channel: string;
      decided_at: string;
    }[]) {
      approvals.set(row.transfer_id, [
        ...(approvals.get(row.transfer_id) ?? []),
        { approverId: row.approver_id, decision: row.decision, comment: row.comment, channel: row.channel, decidedAt: row.decided_at },
      ]);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    requesterId: r.requester_id,
    fromWarehouseId: r.from_warehouse_id,
    toWarehouseId: r.to_warehouse_id,
    reason: r.reason,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionComment: r.decision_comment,
    dispatchedBy: r.dispatched_by,
    dispatchedAt: r.dispatched_at,
    receivedBy: r.received_by,
    receivedAt: r.received_at,
    createdAt: r.created_at,
    lines: lines.get(r.id) ?? [],
    batches: batches.get(r.id) ?? [],
    approvals: approvals.get(r.id) ?? [],
  }));
}

async function oneTransfer(c: Context<AppEnv>, id: string) {
  const [transfer] = await loadTransfers(c, id);
  if (!transfer) throw new HttpError(404, 'Transfer not found', 'not_found');
  return transfer;
}

export function registerTransferRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/transfers', requirePermission('inventory.transfers.read'), async (c) => ok(c, await loadTransfers(c)));

  inventoryRoutes.get('/in-transit', requirePermission('inventory.transfers.read'), async (c) => {
    const rows = await callRpc<{ item_id: string; sku: string; name: string; uom: string; qty: number; transfers: number }[]>(
      userDb(c),
      'inv_in_transit',
      {},
    );
    return ok(
      c,
      (rows ?? []).map((r) => ({ itemId: r.item_id, sku: r.sku, name: r.name, uom: r.uom, qty: Number(r.qty), transfers: r.transfers })),
    );
  });

  inventoryRoutes.get('/transfers/:id', requirePermission('inventory.transfers.read'), async (c) =>
    ok(c, await oneTransfer(c, idParam(c))),
  );

  inventoryRoutes.post('/transfers', requirePermission('inventory.transfers.create'), async (c) => {
    const body = await jsonBody(c);
    const fromWarehouseId = text(body.fromWarehouseId);
    const toWarehouseId = text(body.toWarehouseId);
    if (!UUID_RE.test(fromWarehouseId) || !UUID_RE.test(toWarehouseId)) invalid('Choose a source and a destination warehouse');
    if (fromWarehouseId === toWarehouseId) invalid('The source and destination warehouses must be different');
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const cleaned = lines
      .map((l) => ({ itemId: text((l as Record<string, unknown>)?.itemId), qty: Number((l as Record<string, unknown>)?.qty) }))
      .filter((l) => l.itemId && Number.isFinite(l.qty) && l.qty > 0);
    if (cleaned.length === 0 || cleaned.length !== lines.length) invalid('Add at least one item, each with a quantity above zero');
    const made = await callRpc<{ id: string; number: string }>(userDb(c), 'inv_submit_transfer', {
      p_from_warehouse_id: fromWarehouseId,
      p_to_warehouse_id: toWarehouseId,
      p_reason: text(body.reason),
      p_lines: cleaned,
    });
    return ok(c, await oneTransfer(c, made.id), 201);
  });

  for (const [action, decision] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ] as const) {
    inventoryRoutes.post(`/transfers/:id/${action}`, requirePermission('inventory.transfers.approve'), async (c) => {
      const id = idParam(c);
      const body = await c.req.json().catch(() => ({}));
      await callRpc<void>(userDb(c), 'inv_decide_transfer', {
        p_transfer_id: id,
        p_decision: decision,
        p_comment: text((body as Record<string, unknown>).comment) || null,
        p_channel: 'app',
      });
      return ok(c, await oneTransfer(c, id));
    });
  }

  inventoryRoutes.post('/transfers/:id/dispatch', requirePermission('inventory.transfers.dispatch'), async (c) => {
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'inv_dispatch_transfer', { p_transfer_id: id });
    return ok(c, await oneTransfer(c, id));
  });

  inventoryRoutes.post('/transfers/:id/receive', requirePermission('inventory.transfers.receive'), async (c) => {
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'inv_receive_transfer', { p_transfer_id: id });
    return ok(c, await oneTransfer(c, id));
  });

  inventoryRoutes.post('/transfers/:id/cancel', requirePermission('inventory.transfers.create'), async (c) => {
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'inv_cancel_transfer', { p_transfer_id: id });
    return ok(c, await oneTransfer(c, id));
  });
}

import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { UUID_RE, idParam, orgOf, text } from './helpers';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerBatchRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/storage-conditions', requirePermission('inventory.batches.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('inv_storage_conditions')
      .select('id, name, min_temp_c, max_temp_c')
      .eq('org_id', orgOf(c))
      .order('name');
    if (error) throw error;
    return ok(
      c,
      (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        minTempC: s.min_temp_c === null ? null : Number(s.min_temp_c),
        maxTempC: s.max_temp_c === null ? null : Number(s.max_temp_c),
      })),
    );
  });

  inventoryRoutes.post('/storage-conditions', requirePermission('inventory.batches.manage'), async (c) => {
    const b = await jsonBody(c);
    const name = text(b.name);
    const min = b.minTempC === null || b.minTempC === undefined || b.minTempC === '' ? null : Number(b.minTempC);
    const max = b.maxTempC === null || b.maxTempC === undefined || b.maxTempC === '' ? null : Number(b.maxTempC);
    if (!name || (min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max)))
      invalid('A name is required; temperatures must be numbers');
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
    return ok(
      c,
      (data ?? []).map((b) => ({
        id: b.id,
        itemId: b.item_id,
        batchNo: b.batch_no,
        mfgDate: b.mfg_date,
        expiryDate: b.expiry_date,
        status: b.status,
        supplierId: b.supplier_id,
        stock: ((b.inv_batch_balances ?? []) as { warehouse_id: string; qty: number }[]).map((s) => ({
          warehouseId: s.warehouse_id,
          qty: Number(s.qty),
        })),
      })),
    );
  });

  inventoryRoutes.post('/batches', requirePermission('inventory.batches.receive'), async (c) => {
    const b = await jsonBody(c);
    const itemId = text(b.itemId),
      warehouseId = text(b.warehouseId),
      batchNo = text(b.batchNo);
    const qty = Number(b.qty),
      mfg = text(b.mfgDate),
      exp = text(b.expiryDate),
      supplier = text(b.supplierId);
    // sql/046: the unit cost of the received batch (required once accounting is on; when given it also updates the average cost).
    const cost = b.unitCostMinor === undefined || b.unitCostMinor === null || b.unitCostMinor === '' ? null : Number(b.unitCostMinor);
    if (cost !== null && (!Number.isInteger(cost) || cost < 0))
      invalid('unitCostMinor must be a whole number of minor units, zero or more');
    if (
      !UUID_RE.test(itemId) ||
      !UUID_RE.test(warehouseId) ||
      !batchNo ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      (mfg && !DATE_RE.test(mfg)) ||
      (exp && !DATE_RE.test(exp)) ||
      (supplier && !UUID_RE.test(supplier))
    ) {
      invalid('Item, warehouse, batch number and a quantity above zero are required');
    }
    const id = await callRpc<string>(userDb(c), 'inv_receive_batch', {
      p_item_id: itemId,
      p_warehouse_id: warehouseId,
      p_qty: qty,
      p_batch_no: batchNo,
      p_mfg_date: mfg || null,
      p_expiry_date: exp || null,
      p_supplier_id: supplier || null,
      p_unit_cost_minor: cost,
    });
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
    const rows = await callRpc<
      {
        batch_id: string;
        item_id: string;
        sku: string;
        name: string;
        batch_no: string;
        warehouse_id: string;
        qty: number;
        expiry_date: string;
        days_left: number;
        status: string;
      }[]
    >(userDb(c), 'inv_expiry_report', { p_days: days });
    return ok(
      c,
      rows.map((r) => ({
        batchId: r.batch_id,
        itemId: r.item_id,
        sku: r.sku,
        name: r.name,
        batchNo: r.batch_no,
        warehouseId: r.warehouse_id,
        qty: Number(r.qty),
        expiryDate: r.expiry_date,
        daysLeft: r.days_left,
        status: r.status,
      })),
    );
  });
}

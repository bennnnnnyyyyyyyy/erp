import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError, isMissingSchema } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { UUID_RE, idParam, orgOf, text } from './helpers';

type ItemRow = {
  id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  uom: string;
  reorder_level: number | null;
  tracks_batches?: boolean;
  storage_condition_id?: string | null;
};
const toItem = (r: ItemRow) => ({
  id: r.id,
  sku: r.sku,
  name: r.name,
  nameAr: r.name_ar ?? '',
  uom: r.uom,
  reorderLevel: r.reorder_level === null ? null : Number(r.reorder_level),
  tracksBatches: Boolean(r.tracks_batches),
  storageConditionId: r.storage_condition_id ?? null,
});

export function registerItemRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/items', requirePermission('inventory.items.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('inv_items')
      .select('id, sku, name, name_ar, uom, reorder_level, tracks_batches, storage_condition_id')
      .eq('org_id', orgOf(c))
      .is('deleted_at', null)
      .order('sku');
    if (error) throw error;
    return ok(c, ((data ?? []) as ItemRow[]).map(toItem));
  });

  inventoryRoutes.get('/stock', requirePermission('inventory.items.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('inv_stock_balances')
      .select('item_id, warehouse_id, on_hand, reserved')
      .eq('org_id', orgOf(c));
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

  // The latest stock movements; ?itemId= limits them to one item (the item page, inventory redesign 10 Nov 2026).
  inventoryRoutes.get('/ledger', requirePermission('inventory.items.read'), async (c) => {
    const itemId = c.req.query('itemId');
    if (itemId !== undefined && !UUID_RE.test(itemId)) invalid('itemId must be an item id');
    let query = userDb(c)
      .from('inv_stock_moves')
      .select('id, item_id, warehouse_id, qty, kind, request_id, ref, posted_by, posted_at, inv_requests(number)')
      .eq('org_id', orgOf(c));
    if (itemId) query = query.eq('item_id', itemId);
    const { data, error } = await query.order('id', { ascending: false }).limit(500);
    if (error) throw error;
    type LedgerRow = {
      id: number;
      item_id: string;
      warehouse_id: string;
      qty: number;
      kind: string;
      request_id: string | null;
      ref: string | null;
      posted_by: string;
      posted_at: string;
      inv_requests: { number: string } | { number: string }[] | null;
    };
    return ok(
      c,
      ((data ?? []) as unknown as LedgerRow[]).map((m) => {
        const req = Array.isArray(m.inv_requests) ? m.inv_requests[0] : m.inv_requests;
        return {
          id: m.id,
          itemId: m.item_id,
          warehouseId: m.warehouse_id,
          qty: Number(m.qty),
          kind: m.kind,
          requestId: m.request_id,
          requestNumber: req?.number ?? null,
          ref: m.ref,
          postedBy: m.posted_by,
          postedAt: m.posted_at,
        };
      }),
    );
  });

  // The company's item code format and the next free code (sql/075). Before the migration is applied there is simply no format.
  inventoryRoutes.get('/sku-format', requirePermission('inventory.items.read'), async (c) => {
    try {
      const format = await callRpc<{ prefix: string; digits: number } | null>(userDb(c), 'inv_sku_format', {});
      // The next code needs a role that can create items; a viewer just sees the format.
      let next: string | null = null;
      try {
        next = await callRpc<string | null>(userDb(c), 'inv_next_sku', {});
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 403) throw err;
      }
      return ok(c, { format: format ?? null, next });
    } catch (err) {
      if (isMissingSchema(err)) return ok(c, { format: null, next: null });
      throw err;
    }
  });
  // Choose the format once: a prefix and how many digits (ITM- and 4 gives ITM-0001). Owners and admins; the change is audited.
  inventoryRoutes.put('/sku-format', requirePermission('inventory.items.manage'), async (c) => {
    const body = await jsonBody(c);
    const prefix = text(body.prefix).toUpperCase();
    const digits = Number(body.digits);
    if (!/^[A-Z0-9-]{0,12}$/.test(prefix)) invalid('A prefix is letters, digits and dashes, up to 12');
    if (!Number.isInteger(digits) || digits < 1 || digits > 8) invalid('Digits must be a whole number from 1 to 8');
    const format = await callRpc<{ prefix: string; digits: number }>(userDb(c), 'inv_set_sku_format', {
      p_prefix: prefix,
      p_digits: digits,
    });
    const next = await callRpc<string | null>(userDb(c), 'inv_next_sku', {});
    return ok(c, { format, next });
  });

  inventoryRoutes.post('/items', requirePermission('inventory.items.manage'), async (c) => {
    const body = await jsonBody(c);
    const sku = text(body.sku);
    const name = text(body.name);
    if (!sku || !name) invalid('SKU and name are required');
    const opening = Number(body.openingQty ?? 0);
    if (!Number.isFinite(opening) || opening < 0) invalid('Opening stock must be zero or more');
    const cost = body.unitCostMinor === undefined || body.unitCostMinor === null ? null : Number(body.unitCostMinor);
    if (cost !== null && (!Number.isInteger(cost) || cost < 0))
      invalid('unitCostMinor must be a whole number of minor units, zero or more');
    const id = await callRpc<string>(userDb(c), 'inv_create_item', {
      p_sku: sku,
      p_name: name,
      p_name_ar: text(body.nameAr) || null,
      p_uom: text(body.uom) || 'piece',
      p_opening_qty: opening,
      p_warehouse_id: text(body.warehouseId) || null,
      // sql/046: opening stock is a receipt, so it carries its unit cost (required once accounting is on; it also sets the average).
      p_unit_cost_minor: opening > 0 ? cost : null,
    });
    // No opening stock: the optional average cost is set by hand (efficiency audit 2026-11-04, F4), the existing audited function,
    // owners and admins only. With opening stock the receipt above already set it.
    if (opening === 0 && cost !== null && cost > 0)
      await callRpc<void>(userDb(c), 'inv_set_item_cost', { p_item_id: id, p_unit_cost_minor: cost });
    return ok(
      c,
      toItem({ id, sku: sku.toUpperCase(), name, name_ar: text(body.nameAr) || null, uom: text(body.uom) || 'piece', reorder_level: null }),
      201,
    );
  });

  // Average cost and stock value per item (sql/023 inv_item_costs). The database allows owners and admins only; others get FORBIDDEN,
  // and the item page then simply leaves cost out.
  inventoryRoutes.get('/item-costs', requirePermission('inventory.items.read'), async (c) => {
    const rows = await callRpc<{ item_id: string; avg_cost_minor: number | null; on_hand: number; value_minor: number | null }[]>(
      userDb(c),
      'inv_item_costs',
      {},
    );
    return ok(
      c,
      (rows ?? []).map((r) => ({
        itemId: r.item_id,
        avgCostMinor: r.avg_cost_minor === null ? null : Number(r.avg_cost_minor),
        onHand: Number(r.on_hand),
        valueMinor: r.value_minor === null ? null : Number(r.value_minor),
      })),
    );
  });

  // Fix an item's name in English and Arabic (sql/062, decision D4). The SKU and unit stay; the old and new names are audited.
  inventoryRoutes.put('/items/:id', requirePermission('inventory.items.manage'), async (c) => {
    const body = await jsonBody(c);
    const name = text(body.name);
    if (!name) invalid('Item name is required');
    const id = idParam(c);
    await callRpc<void>(userDb(c), 'inv_update_item', { p_item_id: id, p_name: name, p_name_ar: text(body.nameAr) || null });
    return ok(c, { id, name, nameAr: text(body.nameAr) || null });
  });

  // Set an item's average cost by hand (sql/023 `inv_set_item_cost`: owners and admins only, audited, logged in inv_cost_log). The route
  // check is the early rejection; the database allows only owners and admins. Used by Settings-free flows such as the setup wizard.
  inventoryRoutes.put('/items/:id/cost', requirePermission('inventory.items.manage'), async (c) => {
    const unitCostMinor = Number((await jsonBody(c)).unitCostMinor);
    if (!Number.isInteger(unitCostMinor) || unitCostMinor < 0) invalid('unitCostMinor must be a whole number of minor units, zero or more');
    await callRpc<void>(userDb(c), 'inv_set_item_cost', { p_item_id: idParam(c), p_unit_cost_minor: unitCostMinor });
    return ok(c, { id: idParam(c), unitCostMinor });
  });

  inventoryRoutes.post('/items/:id/reorder-level', requirePermission('inventory.reorder.manage'), async (c) => {
    const id = idParam(c);
    const body = await jsonBody(c);
    const raw = body.level;
    const level = raw === null ? null : Number(raw);
    if (raw === undefined || (level !== null && (!Number.isFinite(level) || level < 0)))
      invalid('Reorder level must be zero or more, or empty');
    await callRpc<void>(userDb(c), 'inv_set_reorder_level', { p_item_id: id, p_level: level });
    const { data, error } = await userDb(c)
      .from('inv_items')
      .select('id, sku, name, name_ar, uom, reorder_level, tracks_batches, storage_condition_id')
      .eq('org_id', orgOf(c))
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, 'Item not found', 'not_found');
    return ok(c, toItem(data as ItemRow));
  });

  // ------------------------------------------------------------------ item units (sql/044)
  // Extra units per item with a conversion factor to the base unit. Owners and admins change them (the database checks); everyone reads.

  inventoryRoutes.get('/items/:id/units', requirePermission('inventory.items.read'), async (c) => {
    const { data, error } = await userDb(c)
      .from('inv_item_units')
      .select('id, unit, factor, for_purchase, for_sale, updated_at')
      .eq('org_id', orgOf(c))
      .eq('item_id', idParam(c))
      .is('deleted_at', null)
      .order('factor');
    if (error) throw error;
    return ok(
      c,
      ((data ?? []) as { id: string; unit: string; factor: number; for_purchase: boolean; for_sale: boolean; updated_at: string }[]).map(
        (u) => ({
          id: u.id,
          unit: u.unit,
          factor: Number(u.factor),
          forPurchase: u.for_purchase,
          forSale: u.for_sale,
          updatedAt: u.updated_at,
        }),
      ),
    );
  });

  // Add or change one unit: { unit, factor, forPurchase?, forSale? }.
  inventoryRoutes.put('/items/:id/units', requirePermission('inventory.items.manage'), async (c) => {
    const body = await jsonBody(c);
    const unit = text(body.unit);
    const factor = Number(body.factor);
    if (!unit || unit.length > 32 || !Number.isFinite(factor) || factor <= 0)
      invalid('A unit name (up to 32 characters) and a factor above zero are required');
    const id = await callRpc<string>(userDb(c), 'inv_set_item_unit', {
      p_item_id: idParam(c),
      p_unit: unit,
      p_factor: factor,
      p_for_purchase: body.forPurchase !== false,
      p_for_sale: body.forSale !== false,
    });
    return ok(c, { id, unit, factor, forPurchase: body.forPurchase !== false, forSale: body.forSale !== false });
  });

  inventoryRoutes.delete('/items/:id/units/:unit', requirePermission('inventory.items.manage'), async (c) => {
    const unit = decodeURIComponent(c.req.param('unit') ?? '').trim();
    if (!unit) invalid('A unit is required');
    await callRpc<void>(userDb(c), 'inv_remove_item_unit', { p_item_id: idParam(c), p_unit: unit });
    return ok(c, { removed: true });
  });

  // Convert a quantity in a unit to the base unit: ?unit=box&qty=3.
  inventoryRoutes.get('/items/:id/to-base', requirePermission('inventory.items.read'), async (c) => {
    const qty = Number(c.req.query('qty'));
    if (!Number.isFinite(qty)) invalid('qty must be a number');
    const base = await callRpc<number>(userDb(c), 'inv_to_base_qty', {
      p_item_id: idParam(c),
      p_unit: c.req.query('unit') || null,
      p_qty: qty,
    });
    return ok(c, { qty: Number(base) });
  });
}

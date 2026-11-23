import type { Context, Hono } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError, isMissingSchema } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { UUID_RE } from './helpers';

// The low stock pop-up (sql/106, plan documentation/plans/LOW_STOCK_POPUP_BUILD_PLAN.md). Only people who can reorder: the route asks
// for inventory.request.create (owners, admins, members), the database refuses viewers again. "Remind me" and "Don't show again" are
// the person's own settings (no audit, Ben 23 Nov). Before sql/106 is applied every route answers 503 not_set_up and no pop-up shows.

type PopupRow = {
  item_id: string;
  sku: string;
  name: string;
  name_ar: string | null;
  uom: string;
  available: number;
  reorder_level: number;
  max_level: number | null;
  on_order: number;
  suggested_qty: number;
  supplier_id: string | null;
  supplier_name: string | null;
  last_cost_minor: number | null;
  currency: string | null;
};

const REORDER = 'inventory.request.create';
const SNOOZE = new Set(['hour', 'tomorrow', 'week']);

async function rpc<T>(c: Context<AppEnv>, fn: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await callRpc<T>(userDb(c), fn, args);
  } catch (err) {
    if (isMissingSchema(err)) throw new HttpError(503, 'The low stock pop-up needs a database update (sql/106).', 'not_set_up');
    throw err;
  }
}

function itemParam(c: Context<AppEnv>): string {
  const id = c.req.param('itemId') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
}

export function registerLowStockRoutes(inventoryRoutes: Hono<AppEnv>) {
  inventoryRoutes.get('/low-stock/popup', requirePermission(REORDER), async (c) => {
    const rows = await rpc<PopupRow[]>(c, 'inv_low_stock_popup', {});
    return ok(
      c,
      (rows ?? []).map((r) => ({
        itemId: r.item_id,
        sku: r.sku,
        name: r.name,
        nameAr: r.name_ar ?? '',
        uom: r.uom,
        available: Number(r.available),
        reorderLevel: Number(r.reorder_level),
        maxLevel: r.max_level === null ? null : Number(r.max_level),
        onOrder: Number(r.on_order),
        suggestedQty: Number(r.suggested_qty),
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        lastCostMinor: r.last_cost_minor === null ? null : Number(r.last_cost_minor),
        currency: r.currency,
      })),
    );
  });

  inventoryRoutes.post('/low-stock/:itemId/snooze', requirePermission(REORDER), async (c) => {
    const span = (await jsonBody(c)).for;
    if (typeof span !== 'string' || !SNOOZE.has(span)) invalid('for must be hour, tomorrow or week');
    const until = await rpc<string>(c, 'inv_snooze_low_stock', { p_item_id: itemParam(c), p_for: span });
    return ok(c, { until });
  });

  inventoryRoutes.post('/low-stock/:itemId/mute', requirePermission(REORDER), async (c) => {
    await rpc<void>(c, 'inv_mute_low_stock', { p_item_id: itemParam(c), p_on: true });
    return ok(c, { muted: true });
  });

  inventoryRoutes.delete('/low-stock/:itemId/mute', requirePermission(REORDER), async (c) => {
    await rpc<void>(c, 'inv_mute_low_stock', { p_item_id: itemParam(c), p_on: false });
    return ok(c, { muted: false });
  });

  // The level a reorder fills stock up to (sql/106). Owners and admins, like the reorder level; audited.
  inventoryRoutes.put('/items/:itemId/max-level', requirePermission('inventory.reorder.manage'), async (c) => {
    const raw = (await jsonBody(c)).level;
    const level = raw === null ? null : Number(raw);
    if (raw === undefined || (level !== null && (!Number.isFinite(level) || level < 0)))
      invalid('Maximum level must be zero or more, or empty');
    await rpc<void>(c, 'inv_set_max_level', { p_item_id: itemParam(c), p_level: level });
    return ok(c, { maxLevel: level });
  });
}

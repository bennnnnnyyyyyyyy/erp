import type { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { userDb } from '../../lib/db.user';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

export function registerForecastRoutes(inventoryRoutes: Hono<AppEnv>) {
  // ------------------------------------------------------------------ stock forecast (sql/029): from the organization's own issue history

  inventoryRoutes.get('/forecast', requirePermission('inventory.forecast.read'), async (c) => {
    const rows = await callRpc<
      {
        item_id: string;
        sku: string;
        name: string;
        uom: string;
        available: number;
        daily_rate: number;
        days_of_cover: number | null;
        runs_out_on: string | null;
        history_days: number;
        issues_count: number;
        confidence: 'good' | 'thin' | 'none';
        lead_days: number;
        on_order: number;
        suggested_order: number | null;
      }[]
    >(userDb(c), 'inv_forecast', {});
    return ok(
      c,
      rows.map((r) => ({
        itemId: r.item_id,
        sku: r.sku,
        name: r.name,
        uom: r.uom,
        available: Number(r.available),
        dailyRate: Number(r.daily_rate),
        daysOfCover: r.days_of_cover,
        runsOutOn: r.runs_out_on,
        historyDays: r.history_days,
        issuesCount: r.issues_count,
        confidence: r.confidence,
        leadDays: r.lead_days,
        onOrder: Number(r.on_order),
        suggestedOrder: r.suggested_order === null ? null : Number(r.suggested_order),
      })),
    );
  });
}

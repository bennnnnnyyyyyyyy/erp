import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { registerAdjustmentRoutes } from './adjustments';
import { registerBatchRoutes } from './batches';
import { registerCountRoutes } from './counts';
import { registerForecastRoutes } from './forecast';
import { registerItemRoutes } from './items';
import { registerRequestRoutes } from './requests';
import { registerTransferRoutes } from './transfers';
import { registerWarehouseRoutes } from './warehouses';

// Inventory slice 1 (documentation/plans/INVENTORY_PLAN.md). Reads use the signed-in user's client (row level
// security) and always filter by the caller's organization, because a user can belong to several. Every change
// is one database function from sql/006, which checks role and module and writes its audit row itself (ADR-0003).
// Response shapes are the ones the web screens already use.
//
// The routes live in one file per resource next to this one; helpers.ts holds the shared small helpers.
// None of the registered paths overlap, so the registration order below does not change which route matches.

export const inventoryRoutes = new Hono<AppEnv>();

registerWarehouseRoutes(inventoryRoutes);
registerItemRoutes(inventoryRoutes);
registerRequestRoutes(inventoryRoutes);
registerAdjustmentRoutes(inventoryRoutes);
registerBatchRoutes(inventoryRoutes);
registerForecastRoutes(inventoryRoutes);
registerCountRoutes(inventoryRoutes);
registerTransferRoutes(inventoryRoutes);

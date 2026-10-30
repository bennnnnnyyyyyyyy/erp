import type { Hono } from 'hono';
import { findModule } from '@erp/shared';
import type { AppEnv } from '../env';
import { coreRoutes } from './core/routes';
import { inventoryRoutes } from './inventory/routes';
import { messagingRoutes } from './messaging/routes';
import { tasksRoutes } from './tasks/routes';
import { purchasingRoutes } from './purchasing/routes';

// Each module's routes, keyed by its manifest key in packages/shared/src/modules.ts.
// Adding a module: create src/modules/<key>/routes.ts, add its manifest, register it here.
export const MODULE_ROUTES: Record<string, Hono<AppEnv>> = {
  core: coreRoutes,
  inventory: inventoryRoutes,
  tasks: tasksRoutes,
  messaging: messagingRoutes,
  purchasing: purchasingRoutes,
};

for (const key of Object.keys(MODULE_ROUTES)) {
  if (!findModule(key)) throw new Error(`Module routes registered for "${key}" but it has no manifest`);
}

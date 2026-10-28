import { Hono } from 'hono';
import type { AppEnv } from '../../env';

// Empty on purpose: inventory logic is built from its approved plan in documentation/plans/.
export const inventoryRoutes = new Hono<AppEnv>();

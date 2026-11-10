import type { Context } from 'hono';
import type { AppEnv } from '../../env';
import { HttpError } from '../../lib/errors';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;

export function idParam(c: Context<AppEnv>): string {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
}

export const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

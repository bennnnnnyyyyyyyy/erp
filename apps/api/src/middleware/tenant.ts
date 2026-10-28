import { createMiddleware } from 'hono/factory';
import { MODULES, defaultPermissionsFor, hasPermission, type Role } from '@ggo/shared';
import type { AppEnv } from '../env';
import { db } from '../lib/db';
import { HttpError } from '../lib/errors';

type MembershipRow = {
  role: Role;
  organizations: {
    id: string;
    name: string;
    slug: string;
    default_currency: string;
    timezone: string;
    settings: Record<string, unknown> | null;
    deleted_at: string | null;
  } | null;
};

/**
 * Resolves the organization the caller is acting in (`X-Org-Id` header) and checks they are
 * an active member. Sets `c.var.tenant`. Must run after `requireAuth`.
 */
export const requireTenant = createMiddleware<AppEnv>(async (c, next) => {
  const orgId = c.req.header('X-Org-Id');
  if (!orgId) throw new HttpError(400, 'Choose an organization first', 'org_required');

  const client = db(c.env);
  const { data: membership, error } = await client
    .from('memberships')
    .select('role, organizations!inner(id, name, slug, default_currency, timezone, settings, deleted_at)')
    .eq('org_id', orgId)
    .eq('user_id', c.var.user.id)
    .is('disabled_at', null)
    .maybeSingle<MembershipRow>();
  if (error) throw error;
  const org = membership?.organizations;
  if (!membership || !org || org.deleted_at) {
    throw new HttpError(403, "You aren't a member of this organization", 'not_a_member');
  }

  const { data: enabled, error: modErr } = await client
    .from('org_modules')
    .select('module_key')
    .eq('org_id', orgId)
    .is('disabled_at', null);
  if (modErr) throw modErr;

  const modules = new Set(MODULES.filter((m) => m.core).map((m) => m.key));
  for (const row of enabled ?? []) modules.add(row.module_key as string);

  c.set('tenant', {
    orgId: org.id,
    orgName: org.name,
    orgSlug: org.slug,
    defaultCurrency: org.default_currency,
    timezone: org.timezone,
    dateFormat: typeof org.settings?.date_format === 'string' ? org.settings.date_format : 'DD/MM/YYYY',
    role: membership.role,
    permissions: defaultPermissionsFor(membership.role),
    modules: [...modules],
  });
  await next();
});

export function requirePermission(permission: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!hasPermission(c.var.tenant.permissions, permission)) {
      throw new HttpError(403, "You don't have permission to do that", 'forbidden');
    }
    await next();
  });
}

export function requireModule(moduleKey: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.var.tenant.modules.includes(moduleKey)) {
      throw new HttpError(403, 'This module is not enabled for your organization', 'module_disabled');
    }
    await next();
  });
}

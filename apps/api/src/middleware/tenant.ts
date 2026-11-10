import { createMiddleware } from 'hono/factory';
import { MODULES, defaultPermissionsFor, hasPermission, type Role } from '@erp/shared';
import type { AppEnv } from '../env';
import { userDb } from '../lib/db.user';
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

  const client = userDb(c);
  // Both reads run at the same time (efficiency audit 2026-11-04, F2): one database round trip instead of two on every request.
  // The module list is only used once the membership check below has passed, and row level security already limits it to members.
  const [{ data: membership, error }, { data: enabled, error: modErr }] = await Promise.all([
    client
      .from('memberships')
      .select('role, organizations!inner(id, name, slug, default_currency, timezone, settings, deleted_at)')
      .eq('org_id', orgId)
      .eq('user_id', c.var.user.id)
      .is('disabled_at', null)
      .maybeSingle<MembershipRow>(),
    client.from('org_modules').select('module_key').eq('org_id', orgId).is('disabled_at', null),
  ]);
  if (error) throw error;
  const org = membership?.organizations;
  if (!membership || !org || org.deleted_at) {
    throw new HttpError(403, "You aren't a member of this organization", 'not_a_member');
  }
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
    language: org.settings?.language === 'ar' ? 'ar' : 'en',
    showTutorial: org.settings?.show_tutorial === true,
    showTour: org.settings?.show_tour === true,
    blindCounts: org.settings?.blind_counts === true,
    ownerSelfApproval: org.settings?.owner_self_approval === true,
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

/**
 * Refuses a module's routes until the organization has switched it on. `openPaths` are prefixes under `/v1/<module>` that stay
 * reachable before that (a module's own set-up screens, for example accounting's switch-on); their routes still check permissions,
 * and the database still checks the role.
 */
export function requireModule(moduleKey: string, openPaths: readonly string[] = []) {
  const base = `/v1/${moduleKey}`;
  return createMiddleware<AppEnv>(async (c, next) => {
    const rest = c.req.path.startsWith(base) ? c.req.path.slice(base.length) : '';
    const open = openPaths.some((p) => rest === p || rest.startsWith(`${p}/`));
    if (!open && !c.var.tenant.modules.includes(moduleKey)) {
      throw new HttpError(403, 'This module is not enabled for your organization', 'module_disabled');
    }
    await next();
  });
}

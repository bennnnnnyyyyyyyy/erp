import { Hono } from 'hono';
import type { SessionInfo } from '@erp/shared';
import type { AppEnv } from '../../env';
import { userDb } from '../../lib/db.user';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { memberRoutes } from './memberRoutes';
import { moduleRoutes } from './moduleRoutes';
import { orgRoutes } from './org';

export const coreRoutes = new Hono<AppEnv>();

coreRoutes.route('/org', orgRoutes);
coreRoutes.route('/members', memberRoutes);
coreRoutes.route('/modules', moduleRoutes);

coreRoutes.get('/session', (c) => {
  const { user, tenant } = c.var;
  const session: SessionInfo = {
    userId: user.id,
    email: user.email,
    org: {
      id: tenant.orgId,
      name: tenant.orgName,
      slug: tenant.orgSlug,
      defaultCurrency: tenant.defaultCurrency,
      timezone: tenant.timezone,
      dateFormat: tenant.dateFormat,
      language: tenant.language,
    },
    role: tenant.role,
    permissions: tenant.permissions,
    modules: tenant.modules,
  };
  return ok(c, session);
});

// Names only (no email, role or sign-in data), for any member, so every screen can show who did what.
coreRoutes.get('/people', async (c) => {
  const people = await callRpc<{ user_id: string; name: string }[]>(userDb(c), 'core_org_people', {});
  return ok(c, people.map((p) => ({ userId: p.user_id, name: p.name })));
});

coreRoutes.get('/audit',requirePermission('core.audit.read'), async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
  const { data, error } = await userDb(c)
    .from('audit_log')
    .select('id, occurred_at, actor_user_id, action, entity_type, entity_id, summary')
    .eq('org_id', c.var.tenant.orgId)
    // `id` is the insertion order. Several entries from one database function share the same timestamp,
    // so ordering by time alone would shuffle them.
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ok(c, data);
});

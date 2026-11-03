import { Hono, type Context } from 'hono';
import type { SessionInfo } from '@erp/shared';
import type { AppEnv } from '../../env';
import { userDb } from '../../lib/db.user';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { invalid, jsonBody } from '../../lib/body';
import { requirePermission } from '../../middleware/tenant';
import { memberRoutes } from './memberRoutes';
import { moduleRoutes } from './moduleRoutes';
import { orgRoutes } from './org';

export const coreRoutes = new Hono<AppEnv>();

coreRoutes.route('/org', orgRoutes);
coreRoutes.route('/members', memberRoutes);
coreRoutes.route('/modules', moduleRoutes);

// The person's own saved language (sql/038). A display preference, not essential: if it cannot be read (for example the migration is not
// applied yet) the session still loads and the person simply follows the company default.
async function savedLanguage(c: Context<AppEnv>): Promise<'en' | 'ar' | null> {
  try {
    const { data, error } = await userDb(c).from('user_preferences').select('language').eq('user_id', c.var.user.id).maybeSingle();
    if (error) return null;
    const l = (data as { language: string | null } | null)?.language;
    return l === 'ar' || l === 'en' ? l : null;
  } catch {
    return null;
  }
}

coreRoutes.get('/session', async (c) => {
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
      showTutorial: tenant.showTutorial,
    },
    role: tenant.role,
    permissions: tenant.permissions,
    modules: tenant.modules,
    userLanguage: await savedLanguage(c),
  };
  return ok(c, session);
});

// Save (or clear, with null) the signed-in person's own language. Any signed-in member may do this for themselves only; the database
// function uses the caller's own identity, so there is no way to set another person's language.
coreRoutes.post('/me/language', async (c) => {
  const body = await jsonBody(c);
  const language = body.language;
  if (language !== null && language !== 'en' && language !== 'ar') invalid('Language must be en, ar or null');
  await callRpc<void>(userDb(c), 'core_set_my_language', { p_language: language });
  return ok(c, { language });
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

import { Hono, type Context } from 'hono';
import { DEFAULT_STAGES, MODULES, findModule, type ModuleStatus } from '@ggo/shared';
import type { AppEnv } from '../../env';
import { writeAudit } from '../../lib/audit';
import { db } from '../../lib/db';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

type Ctx = Context<AppEnv>;

// Set-up a module needs the first time an org switches it on. Must be safe to run again.
const ON_ENABLE: Record<string, (c: Ctx) => Promise<void>> = {
  crm: async (c) => {
    const client = db(c.env);
    const orgId = c.var.tenant.orgId;
    const { count, error } = await client
      .from('crm_pipeline_stages')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .is('deleted_at', null);
    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') throw new HttpError(503, 'Run sql/003_crm_and_activities.sql first', 'migration_missing');
      throw error;
    }
    if (count) return;
    const { error: insErr } = await client.from('crm_pipeline_stages').insert(DEFAULT_STAGES.map((s) => ({ ...s, org_id: orgId })));
    if (insErr) throw insErr;
  },
};

export const moduleRoutes = new Hono<AppEnv>();

moduleRoutes.get('/', requirePermission('core.org.read'), (c) => {
  const list: ModuleStatus[] = MODULES.map((m) => ({
    key: m.key,
    name: m.name,
    description: m.description,
    suite: m.suite,
    core: m.core,
    enabled: c.var.tenant.modules.includes(m.key),
  }));
  return ok(c, list);
});

for (const action of ['enable', 'disable'] as const) {
  moduleRoutes.post(`/:key/${action}`, requirePermission('core.org.manage'), async (c) => {
    const mod = findModule(c.req.param('key'));
    if (!mod) throw new HttpError(404, 'Unknown module', 'not_found');
    if (mod.core) throw new HttpError(400, `${mod.name} is always on`, 'invalid_input');
    const enabled = c.var.tenant.modules;

    if (action === 'enable') {
      const missing = mod.dependsOn.filter((d) => !enabled.includes(d));
      if (missing.length) throw new HttpError(400, `Switch on ${missing.join(', ')} first`, 'invalid_input');
      await ON_ENABLE[mod.key]?.(c);
    } else {
      const dependents = MODULES.filter((m) => enabled.includes(m.key) && m.dependsOn.includes(mod.key));
      if (dependents.length) throw new HttpError(400, `Switch off ${dependents.map((m) => m.name).join(', ')} first`, 'invalid_input');
    }

    const { error } = await db(c.env)
      .from('org_modules')
      .upsert(
        {
          org_id: c.var.tenant.orgId,
          module_key: mod.key,
          enabled_by: c.var.user.id,
          ...(action === 'enable' ? { enabled_at: new Date().toISOString(), disabled_at: null } : { disabled_at: new Date().toISOString() }),
        },
        { onConflict: 'org_id,module_key' },
      );
    if (error) throw error;
    await writeAudit(c, {
      action: `module.${action}d`,
      entityType: 'module',
      entityId: mod.key,
      summary: `${mod.name} switched ${action === 'enable' ? 'on' : 'off'}`,
    });
    return ok(c, { key: mod.key, enabled: action === 'enable' });
  });
}

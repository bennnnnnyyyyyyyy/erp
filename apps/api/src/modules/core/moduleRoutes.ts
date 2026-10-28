import { Hono, type Context } from 'hono';
import { MODULES, findModule, type ModuleStatus } from '@erp/shared';
import type { AppEnv } from '../../env';
import { callRpc } from '../../lib/rpc';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

type Ctx = Context<AppEnv>;

// Set-up a module needs the first time an org switches it on. Must be safe to run again.
const ON_ENABLE: Record<string, (c: Ctx) => Promise<void>> = {};

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

    // The database function switches the module and writes the audit row in one transaction (ADR-0003).
    await callRpc<void>(userDb(c), 'core_set_module', { p_module_key: mod.key, p_enabled: action === 'enable' });
    return ok(c, { key: mod.key, enabled: action === 'enable' });
  });
}

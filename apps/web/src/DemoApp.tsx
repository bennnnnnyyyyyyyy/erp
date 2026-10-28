import { useEffect, useMemo, useState } from 'react';
import { defaultPermissionsFor, type ModuleStatus, type Role, type SessionInfo } from '@erp/shared';
import { Shell } from './components/Shell';
import { demoApi } from './lib/demo';
import { SessionContext } from './session';

const ROLES: Role[] = ['owner', 'admin', 'member', 'viewer'];

// Runs the real shell and screens on sample data (see lib/demo.ts). The banner lets you switch role
// to check what each role can see; modules are switched on from Settings > Apps.
export function DemoApp() {
  const [role, setRole] = useState<Role>('owner');
  const [tick, setTick] = useState(0);
  const [modules, setModules] = useState<string[] | null>(null);

  useEffect(() => {
    demoApi<ModuleStatus[]>('/v1/core/modules').then((list) => setModules(list.filter((m) => m.enabled).map((m) => m.key)));
  }, [tick]);

  const session = useMemo<SessionInfo | null>(
    () =>
      modules && {
        userId: 'u1',
        email: 'layla.hassan@demo.example',
        org: { id: 'demo-org', name: 'Demo Trading Co.', slug: 'demo-trading', defaultCurrency: 'EGP', timezone: 'Africa/Cairo', dateFormat: 'DD/MM/YYYY' },
        role,
        permissions: defaultPermissionsFor(role),
        modules,
      },
    [role, modules],
  );

  if (!session) return null;

  return (
    <SessionContext.Provider value={{ session, reload: () => setTick((t) => t + 1) }}>
      <div className="demo-banner" role="status">
        <strong>Demo mode</strong>: sample data in memory, no database. Reload resets it.
        <label>
          Viewing as{' '}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Shell onSwitchOrg={() => undefined} onSignOut={() => undefined} />
    </SessionContext.Provider>
  );
}

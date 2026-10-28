import { useEffect, useMemo, useState } from 'react';
import { defaultPermissionsFor, type ModuleStatus, type Role, type SessionInfo } from '@erp/shared';
import { Shell } from './components/Shell';
import { demoActor, demoApi } from './lib/demo';
import { ACTOR_NAMES } from './lib/demoInventory';
import { SessionContext } from './session';

const ROLES: Role[] = ['owner', 'admin', 'member', 'viewer'];
// Each role is a different person, so "you cannot approve your own request" can be tried for real.
const ACTOR_BY_ROLE: Record<Role, string> = { owner: 'u1', admin: 'u2', member: 'u3', viewer: 'u4' };

// Runs the real shell and screens on sample data (see lib/demo.ts). The banner lets you switch role
// to check what each role can see; modules are switched on from Settings > Apps.
export function DemoApp() {
  const [role, setRole] = useState<Role>('owner');
  const [tick, setTick] = useState(0);
  const [modules, setModules] = useState<string[] | null>(null);
  // Set before any screen loads, so every call is made as the person currently chosen.
  demoActor.id = ACTOR_BY_ROLE[role];
  demoActor.role = role;

  useEffect(() => {
    demoApi<ModuleStatus[]>('/v1/core/modules').then((list) => setModules(list.filter((m) => m.enabled).map((m) => m.key)));
  }, [tick]);

  const session = useMemo<SessionInfo | null>(
    () =>
      modules && {
        userId: ACTOR_BY_ROLE[role],
        email: `${(ACTOR_NAMES[ACTOR_BY_ROLE[role]] ?? 'demo user').toLowerCase().replace(/[^a-z]+/g, '.')}@demo.example`,
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
          Acting as{' '}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ACTOR_NAMES[ACTOR_BY_ROLE[r]]} ({r})
              </option>
            ))}
          </select>
        </label>
      </div>
      <Shell key={role} onSwitchOrg={() => undefined} onSignOut={() => undefined} />
    </SessionContext.Provider>
  );
}

import { hasPermission } from '@ggo/shared';
import { Link } from '../../lib/router';
import { useSession } from '../../session';
import { SUITE_ORDER, type AppDef } from '../registry';
import { MyTasks } from './MyTasks';

function greeting(timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// The home screen: a greeting, "My day", then one tile per app the user can open, grouped by suite.
export function Home({ apps }: { apps: AppDef[] }) {
  const session = useSession();
  const suites = SUITE_ORDER.map((suite) => ({ suite, apps: apps.filter((a) => a.suite === suite) })).filter(
    (s) => s.apps.length > 0,
  );
  const hasBusinessApps = apps.some((a) => a.module !== 'core');
  const canManageApps = hasPermission(session.permissions, 'core.org.manage');

  return (
    <section className="home">
      <h1>{greeting(session.org?.timezone ?? 'UTC')}</h1>
      <p className="muted">{session.org?.name}</p>

      {!hasBusinessApps && canManageApps && (
        <p className="notice">
          No business apps are switched on yet. <Link to="/settings/apps">Switch on CRM</Link> to start adding clients and deals.
        </p>
      )}

      {session.modules.includes('crm') && (
        <div className="home-grid">
          <MyTasks />
        </div>
      )}

      {suites.length === 0 && <p className="muted">No apps are available to you yet. Ask an admin for access.</p>}
      {suites.map(({ suite, apps }) => (
        <div key={suite} className="suite">
          <h2 className="suite-heading">{suite}</h2>
          <div className="tiles">
            {apps.map((a) => (
              <Link key={a.key} to={a.basePath} className="tile">
                <span className={`tile-icon tile-${a.module}`} aria-hidden="true">
                  {a.name.slice(0, 1)}
                </span>
                <span className="tile-name">{a.name}</span>
                <span className="tile-desc muted">{a.description}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

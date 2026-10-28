import type { CSSProperties, ReactNode } from 'react';
import { hasPermission } from '@erp/shared';
import { Link } from '../../lib/router';
import { useSession } from '../../session';
import { SUITE_ORDER, type AppDef } from '../registry';

function greeting(timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function today(timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

// One simple line icon per app, keyed by the app key. Unknown apps fall back to their first letter.
const ICONS: Record<string, ReactNode> = {
  inventory: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 8l9-5 9 5v8l-9 5-9-5V8z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  ),
};

// The home screen: a greeting, then one tile per app the user can open, grouped by suite.
export function Home({ apps }: { apps: AppDef[] }) {
  const session = useSession();
  const timeZone = session.org?.timezone ?? 'UTC';
  const suites = SUITE_ORDER.map((suite) => ({ suite, apps: apps.filter((a) => a.suite === suite) })).filter(
    (s) => s.apps.length > 0,
  );
  const hasBusinessApps = apps.some((a) => a.module !== 'core');
  const canManageApps = hasPermission(session.permissions, 'core.org.manage');
  let tileIndex = 0;

  return (
    <section className="home">
      <h1>{greeting(timeZone)}</h1>
      <p className="muted">
        {session.org?.name} · {today(timeZone)}
      </p>

      {!hasBusinessApps && canManageApps && (
        <p className="notice">
          No business apps are switched on yet. <Link to="/settings/apps">Switch on Inventory</Link> to start managing stock.
        </p>
      )}

      {suites.length === 0 && <p className="muted">No apps are available to you yet. Ask an admin for access.</p>}
      {suites.map(({ suite, apps }) => (
        <div key={suite} className="suite">
          <h2 className="suite-heading">{suite}</h2>
          <div className="tiles">
            {apps.map((a) => (
              <Link key={a.key} to={a.basePath} className="tile" style={{ '--i': tileIndex++ } as CSSProperties}>
                <span className="tile-icon" aria-hidden="true">
                  {ICONS[a.key] ?? a.name.slice(0, 1)}
                </span>
                <span className="tile-go" aria-hidden="true">→</span>
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

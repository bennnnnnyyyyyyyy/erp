import { useEffect, useRef, useState } from 'react';
import { Link, ParamsContext, usePath } from '../lib/router';
import { GlobalSearch } from './GlobalSearch';
import { resolveRoute, visibleApps } from '../modules/registry';
import { Home } from '../modules/core/Home';
import { useSession } from '../session';

function initials(email: string): string {
  const name = email.split('@')[0] ?? '';
  const bits = name.split(/[._-]+/).filter(Boolean);
  return ((bits[0]?.[0] ?? '') + (bits[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
}

function UserMenu({ onSwitchOrg, onSignOut }: { onSwitchOrg: () => void; onSignOut: () => void }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="user-menu" ref={ref}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {initials(session.email)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <div>{session.email}</div>
            <div className="muted small">
              {session.org?.name} · {session.role}
            </div>
          </div>
          <button role="menuitem" className="menu-item" onClick={onSwitchOrg}>
            Switch organization
          </button>
          <button role="menuitem" className="menu-item" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ onSwitchOrg, onSignOut }: { onSwitchOrg: () => void; onSignOut: () => void }) {
  const session = useSession();
  const path = usePath();
  const apps = visibleApps(session);
  const route = resolveRoute(path, apps);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => setDrawerOpen(false), [path]);
  useEffect(() => {
    const where = route?.page ? `${route.page.label} · ${route.app.name}` : route?.app.name;
    document.title = [where, session.org?.name].filter(Boolean).join(' · ') || 'ERP';
  }, [route, session.org?.name]);

  const atHome = path === '/' || path === '';
  const Page = route?.page?.component;

  return (
    <div className={route ? 'shell with-sidebar' : 'shell'}>
      <header className="topbar">
        {route && (
          <button className="icon-btn drawer-toggle" onClick={() => setDrawerOpen((o) => !o)} aria-label="Menu">
            ☰
          </button>
        )}
        <Link to="/" className={atHome ? 'apps-btn active' : 'apps-btn'} aria-label="All apps">
          <span className="grid-icon" aria-hidden="true" />
          Apps
        </Link>
        <span className="topbar-org">{session.org?.name}</span>
        {route && <span className="topbar-app">/ {route.app.name}</span>}
        <span className="spacer" />
        {session.modules.includes('crm') && <GlobalSearch />}
        <UserMenu onSwitchOrg={onSwitchOrg} onSignOut={onSignOut} />
      </header>

      {route && (
        <nav className={drawerOpen ? 'sidebar open' : 'sidebar'} aria-label={`${route.app.name} pages`}>
          <div className="nav-heading">{route.app.name}</div>
          {route.app.pages.filter((p) => p.nav !== false).map((p) => {
            const to = route.app.basePath + p.path;
            const active = p === route.page || route.page?.parent === p.path;
            return (
              <Link key={to} to={to} className={active ? 'nav-item active' : 'nav-item'}>
                {p.label}
              </Link>
            );
          })}
        </nav>
      )}

      <main className="content">
        {atHome ? (
          <Home apps={apps} />
        ) : Page ? (
          <ParamsContext.Provider value={route.params}>
            <Page key={path} />
          </ParamsContext.Provider>
        ) : (
          <section>
            <h1>Page not found</h1>
            <p className="muted">
              This page doesn't exist or you don't have access to it. <Link to="/">Back to apps</Link>
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

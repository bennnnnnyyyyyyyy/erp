import { useEffect, useRef, type SyntheticEvent } from 'react';
import { useI18n } from '../lib/i18n';
import { Link, usePath } from '../lib/router';
import { MENU_GROUPS, type AppDef, type AppPage } from '../modules/registry';
import { AppIcon, PageIcon, appHueStyle } from './icons';

// The current app's menu in the top bar, Odoo style: single pages as items, grouped pages (MENU_GROUPS) as one dropdown each. Every
// item has an icon. Dropdowns are <details>, so they work with the keyboard and their links stay in the page; one opens at a time and
// all close on navigation or a click elsewhere. On a phone the same entries are listed in the drawer instead (DrawerMenu).

type Entry = { kind: 'page'; page: AppPage } | { kind: 'group'; name: string; pages: AppPage[] };

// Single pages first (in registry order), then the groups in the order MENU_GROUPS lists them, each group's pages in that order too
// (Odoo: Operations, Reporting, Configuration; requests before transfers before adjustments).
function entries(app: AppDef): Entry[] {
  const groups = MENU_GROUPS[app.key] ?? {};
  const pages = app.pages.filter((p) => p.nav !== false);
  const out: Entry[] = pages.filter((p) => !groups[p.path]).map((page) => ({ kind: 'page', page }));
  for (const [path, name] of Object.entries(groups)) {
    const page = pages.find((p) => p.path === path);
    if (!page) continue;   // not available to this person or not in this build
    const existing = out.find((e): e is Extract<Entry, { kind: 'group' }> => e.kind === 'group' && e.name === name);
    if (existing) existing.pages.push(page);
    else out.push({ kind: 'group', name, pages: [page] });
  }
  return out;
}

const isActive = (page: AppPage, current: AppPage | undefined) => page === current || current?.parent === page.path;

function PageLink({ app, page, current, className }: { app: AppDef; page: AppPage; current: AppPage | undefined; className: string }) {
  const { t } = useI18n();
  const active = isActive(page, current);
  return (
    <Link to={app.basePath + page.path} className={active ? `${className} active` : className} aria-current={active ? 'page' : undefined}>
      <span className="menu-icon"><PageIcon appKey={app.key} path={page.path} /></span>
      <span>{t(page.label)}</span>
    </Link>
  );
}

export function AppMenu({ app, current }: { app: AppDef; current: AppPage | undefined }) {
  const { t } = useI18n();
  const path = usePath();
  const ref = useRef<HTMLDivElement>(null);
  // Close every dropdown on navigation and on a click outside the menu.
  useEffect(() => {
    ref.current?.querySelectorAll('details[open]').forEach((d) => d.removeAttribute('open'));
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.querySelectorAll('details[open]').forEach((d) => d.removeAttribute('open'));
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (!e.currentTarget.open) return;
    ref.current?.querySelectorAll('details[open]').forEach((d) => { if (d !== e.currentTarget) d.removeAttribute('open'); });
  };

  return (
    <div className="appmenu" ref={ref} role="navigation" aria-label={`${t(app.name)} · ${t('Menu')}`}>
      {entries(app).map((e) =>
        e.kind === 'page' ? (
          <PageLink key={e.page.path || 'home'} app={app} page={e.page} current={current} className="appmenu-item" />
        ) : (
          <details key={e.name} className={e.pages.some((p) => isActive(p, current)) ? 'appmenu-group active' : 'appmenu-group'} onToggle={onToggle}>
            <summary className="appmenu-item">{t(e.name)}<span className="appmenu-caret" aria-hidden="true">▾</span></summary>
            <div className="appmenu-pop" role="menu">
              {e.pages.map((p) => <PageLink key={p.path} app={app} page={p} current={current} className="appmenu-pop-item" />)}
            </div>
          </details>
        ),
      )}
    </div>
  );
}

/** The same menu for phones: a drawer opened from the menu button, with the groups as headings. */
export function DrawerMenu({ app, current, open }: { app: AppDef; current: AppPage | undefined; open: boolean }) {
  const { t } = useI18n();
  return (
    <nav className={open ? 'sidebar open' : 'sidebar'} style={appHueStyle(app.key)} aria-label={`${t(app.name)} · ${t('Menu')}`}>
      <Link to={app.basePath || '/'} className="sidebar-app">
        <span className="sidebar-app-icon"><AppIcon appKey={app.key} name={t(app.name)} /></span>
        <span className="sidebar-app-name">{t(app.name)}</span>
      </Link>
      {entries(app).map((e) =>
        e.kind === 'page' ? (
          <PageLink key={e.page.path || 'home'} app={app} page={e.page} current={current} className="nav-item" />
        ) : (
          <div key={e.name} className="nav-group">
            <div className="nav-group-heading">{t(e.name)}</div>
            {e.pages.map((p) => <PageLink key={p.path} app={app} page={p} current={current} className="nav-item" />)}
          </div>
        ),
      )}
    </nav>
  );
}

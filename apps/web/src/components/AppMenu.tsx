import { useI18n } from '../lib/i18n';
import { Link } from '../lib/router';
import { MENU_GROUPS, type AppDef, type AppPage } from '../modules/registry';
import { PageIcon } from './icons';

// The current app's menu: a left list in every app (Ben, 9 Nov 2026), with grouped pages (MENU_GROUPS) under a heading. Every item has an
// icon. It stays in view on a desktop; on a phone it is a drawer opened from the menu button in the top bar.

type Entry = { kind: 'page'; page: AppPage } | { kind: 'group'; name: string; pages: AppPage[] };

// Single pages first (in registry order), then the groups in the order MENU_GROUPS lists them, each group's pages in that order too
// (Operations, Reporting, Configuration; requests before transfers before adjustments).
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

function PageLink({ app, page, current }: { app: AppDef; page: AppPage; current: AppPage | undefined }) {
  const { t } = useI18n();
  const active = isActive(page, current);
  return (
    <Link to={app.basePath + page.path} className={active ? 'nav-item active' : 'nav-item'} aria-current={active ? 'page' : undefined}>
      <span className="menu-icon"><PageIcon appKey={app.key} path={page.path} /></span>
      <span>{t(page.label)}</span>
    </Link>
  );
}

export function AppSideMenu({ app, current, open }: { app: AppDef; current: AppPage | undefined; open: boolean }) {
  const { t } = useI18n();
  return (
    <nav className={open ? 'sidebar open' : 'sidebar'} aria-label={`${t(app.name)} · ${t('Menu')}`}>
      {entries(app).map((e) =>
        e.kind === 'page' ? (
          <PageLink key={e.page.path || 'home'} app={app} page={e.page} current={current} />
        ) : (
          <div key={e.name} className="nav-group">
            <div className="nav-group-heading">{t(e.name)}</div>
            {e.pages.map((p) => <PageLink key={p.path} app={app} page={p} current={current} />)}
          </div>
        ),
      )}
    </nav>
  );
}

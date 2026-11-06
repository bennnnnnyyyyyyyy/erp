import { Suspense, useEffect, useRef, useState } from 'react';
import { Loading } from './Loading';
import { api } from '../lib/api';
import { demoMode } from '../lib/demo';
import { useI18n } from '../lib/i18n';
import { Link, ParamsContext, usePath } from '../lib/router';
import { useTheme } from '../lib/theme';
import { preloadScreens, resolveRoute, visibleApps } from '../modules/registry';
import { AppMenu, DrawerMenu } from './AppMenu';
import { AppIcon } from './icons';
import { Home } from '../modules/core/Home';
import { TourHost } from '../modules/help/TourHost';
import { TableLabels } from './TableLabels';
import { useSession } from '../session';
import { FirstRunLanguage } from './LanguageChooser';
import { NotificationBell } from './NotificationBell';

/** Two letters for the avatar: from the person's name when there is one ("Chris Johnson" -> CJ), else from the email. */
function initials(email: string, name?: string | null): string {
  const source = name?.trim() || (email.split('@')[0] ?? '');
  const bits = source.split(/[\s._-]+/).filter(Boolean);
  return ((bits[0]?.[0] ?? '') + (bits[1]?.[0] ?? '')).toUpperCase() || source.slice(0, 2).toUpperCase();
}

function UserMenu({ onSwitchOrg, onSignOut }: { onSwitchOrg: () => void; onSignOut: () => void }) {
  const session = useSession();
  const { t } = useI18n();
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
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={session.name ?? session.email}>
        {initials(session.email, session.name)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            {session.name && <div className="font-semibold"><bdi>{session.name}</bdi></div>}
            <div className={session.name ? 'muted small' : undefined}>{session.email}</div>
            <div className="muted small">
              <bdi>{session.org?.name}</bdi> · {session.role ? t(session.role) : ''}
            </div>
          </div>
          <button role="menuitem" className="menu-item" onClick={onSwitchOrg}>
            {t('Switch organization')}
          </button>
          <button role="menuitem" className="menu-item" onClick={onSignOut}>
            {t('Sign out')}
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ onSwitchOrg, onSignOut }: { onSwitchOrg: () => void; onSignOut: () => void }) {
  const session = useSession();
  const { t, lang, setOrgLang, syncAccountLang, setAccountSaver, asked, ready } = useI18n();
  const { dark, toggle } = useTheme();
  // The company language (Settings > General) is only the default. A person's own choice (Settings > General > My language) wins.
  const orgLanguage = session.org?.language;
  useEffect(() => {
    if (!demoMode && orgLanguage) setOrgLang(orgLanguage);
  }, [orgLanguage, setOrgLang]);
  // The person's own language is saved on their account (sql/038): saves go to the API, and what the account holds is applied on sign-in.
  useEffect(() => {
    if (demoMode) return;
    setAccountSaver((l) => api('/v1/core/me/language', { method: 'POST', body: JSON.stringify({ language: l }) }).then(() => undefined));
    return () => setAccountSaver(null);
  }, [setAccountSaver]);
  const userLanguage = session.userLanguage ?? null;
  useEffect(() => {
    if (!demoMode) syncAccountLang(userLanguage, session.userLanguageAsked ?? false);
  }, [session.userId, userLanguage, session.userLanguageAsked, syncAccountLang]);
  const path = usePath();
  const apps = visibleApps(session);
  const route = resolveRoute(path, apps);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => setDrawerOpen(false), [path]);
  // Fetch every screen's code once the browser is idle after sign-in, so no page (and no tour step) waits for a download later.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    // Production only: the dev server serves every module unbundled, where preloading means hundreds of requests per page load.
    if (!import.meta.env.PROD) return;
    const run = () => preloadScreens();
    if (w.requestIdleCallback) w.requestIdleCallback(run); else setTimeout(run, 1500);
  }, []);
  useEffect(() => {
    const where = route?.page ? `${t(route.page.label)} · ${t(route.app.name)}` : route ? t(route.app.name) : undefined;
    document.title = [where, session.org?.name].filter(Boolean).join(' · ') || 'ERP';
  }, [route, session.org?.name]);

  const atHome = path === '/' || path === '';
  const Page = route?.page?.component;

  return (
    <div className="shell">
      <TourHost />
      <TableLabels />
      {!demoMode && ready && !asked && <FirstRunLanguage />}
      {/* Keyboard users jump past the top bar and the sidebar straight to the page (visible only when focused). */}
      <a href="#main" className="skip-link">{t('Skip to content')}</a>
      {/* Odoo-style top bar: apps grid, the current app (icon and name), its menu across the bar; company and account at the end.
          On a phone the menu moves into a drawer opened with the menu button. */}
      <header className="topbar">
        {route && (
          <button className="icon-btn drawer-toggle" onClick={() => setDrawerOpen((o) => !o)} aria-label={t('Menu')} aria-expanded={drawerOpen}>
            ☰
          </button>
        )}
        <Link to="/" className={atHome ? 'apps-btn active' : 'apps-btn'} aria-label={t('All apps')} title={t('All apps')}>
          <span className="grid-icon" aria-hidden="true" />
          {!route && t('Apps')}
        </Link>
        {route ? (
          <Link to={route.app.basePath || '/'} className="topbar-app-link">
            <span className="topbar-app-icon"><AppIcon appKey={route.app.key} name={t(route.app.name)} /></span>
            <span>{t(route.app.name)}</span>
          </Link>
        ) : (
          <span className="topbar-org"><bdi>{session.org?.name}</bdi></span>
        )}
        {route && <AppMenu app={route.app} current={route.page ?? undefined} />}
        <span className="spacer" />
        {route && <span className="topbar-org-end"><bdi>{session.org?.name}</bdi></span>}
        <button className="icon-btn" onClick={toggle} aria-label={dark ? t('Switch to light mode') : t('Switch to dark mode')} title={dark ? t('Switch to light mode') : t('Switch to dark mode')}>
          {dark ? '☀' : '☾'}
        </button>
        <NotificationBell />
        <UserMenu onSwitchOrg={onSwitchOrg} onSignOut={onSignOut} />
      </header>

      {route && <DrawerMenu app={route.app} current={route.page ?? undefined} open={drawerOpen} />}

      <main className="content" id="main" tabIndex={-1}>
        {atHome ? (
          <Home apps={apps} />
        ) : Page ? (
          <ParamsContext.Provider value={route.params}>
            {/* Pages are lazy chunks (modules/registry.tsx): the skeleton shows while one is fetched the first time. */}
            <Suspense fallback={<section className="page"><Loading /></section>}>
              <Page key={`${lang}:${path}`} />
            </Suspense>
          </ParamsContext.Provider>
        ) : (
          <section>
            <h1>{t('Page not found')}</h1>
            <p className="muted">
              {t("This page doesn't exist or you don't have access to it.")} <Link to="/">{t('Back to apps')}</Link>
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

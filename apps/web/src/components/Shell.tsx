import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { demoMode } from '../lib/demo';
import { useI18n } from '../lib/i18n';
import { Link, ParamsContext, usePath } from '../lib/router';
import { useTheme } from '../lib/theme';
import { resolveRoute, visibleApps } from '../modules/registry';
import { Home } from '../modules/core/Home';
import { TourHost } from '../modules/help/TourHost';
import { useSession } from '../session';
import { FirstRunLanguage } from './LanguageChooser';
import { NotificationBell } from './NotificationBell';

function initials(email: string): string {
  const name = email.split('@')[0] ?? '';
  const bits = name.split(/[._-]+/).filter(Boolean);
  return ((bits[0]?.[0] ?? '') + (bits[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
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
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {initials(session.email)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <div>{session.email}</div>
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
  const { t, setOrgLang, syncAccountLang, setAccountSaver, asked, ready } = useI18n();
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
  useEffect(() => {
    const where = route?.page ? `${t(route.page.label)} · ${t(route.app.name)}` : route ? t(route.app.name) : undefined;
    document.title = [where, session.org?.name].filter(Boolean).join(' · ') || 'ERP';
  }, [route, session.org?.name]);

  const atHome = path === '/' || path === '';
  const Page = route?.page?.component;

  return (
    <div className={route ? 'shell with-sidebar' : 'shell'}>
      <TourHost />
      {!demoMode && ready && !asked && <FirstRunLanguage />}
      <header className="topbar">
        {route && (
          <button className="icon-btn drawer-toggle" onClick={() => setDrawerOpen((o) => !o)} aria-label={t('Menu')}>
            ☰
          </button>
        )}
        <span className="brand-mark" aria-hidden="true" />
        <Link to="/" className={atHome ? 'apps-btn active' : 'apps-btn'} aria-label={t('All apps')}>
          <span className="grid-icon" aria-hidden="true" />
          {t('Apps')}
        </Link>
        <span className="topbar-org"><bdi>{session.org?.name}</bdi></span>
        {route && <span className="topbar-app">/ {t(route.app.name)}</span>}
        <span className="spacer" />
        <button className="icon-btn" onClick={toggle} aria-label={dark ? t('Switch to light mode') : t('Switch to dark mode')} title={dark ? t('Switch to light mode') : t('Switch to dark mode')}>
          {dark ? '☀' : '☾'}
        </button>
        <NotificationBell />
        <UserMenu onSwitchOrg={onSwitchOrg} onSignOut={onSignOut} />
      </header>

      {route && (
        <nav className={drawerOpen ? 'sidebar open' : 'sidebar'} aria-label={`${t(route.app.name)} · ${t('Menu')}`}>
          <div className="nav-heading">{t(route.app.name)}</div>
          {route.app.pages.filter((p) => p.nav !== false).map((p) => {
            const to = route.app.basePath + p.path;
            const active = p === route.page || route.page?.parent === p.path;
            return (
              <Link key={to} to={to} className={active ? 'nav-item active' : 'nav-item'}>
                {t(p.label)}
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

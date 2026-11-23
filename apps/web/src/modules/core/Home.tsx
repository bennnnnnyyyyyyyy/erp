import { useEffect, type CSSProperties } from 'react';
import { hasPermission } from '@erp/shared';
import { api } from '../../lib/api';
import { Link, navigate } from '../../lib/router';
import { readProgress, shouldAutoStart } from '../help/onboardingContent';
import {useI18n, tr } from '../../lib/i18n';
import { useSession } from '../../session';
import { SUITE_ORDER, type AppDef } from '../registry';
import { OwnerSummary } from './OwnerHome';
import { TourButton } from '../help/TourHost';
import { AppIcon } from '../../components/icons';

function greeting(timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function today(timeZone: string, lang: 'en' | 'ar'): string {
  // Arabic month and day names, but Western digits like the rest of the app (-u-nu-latn).
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
}

// First run: in a brand-new company (tutorial flag on, no warehouse yet), someone who can manage the company is taken to the setup wizard
// once. "Not now" or "Leave setup" stops it on this device (UX audit: it came back in every new tab); finishing stops it for good.
function useFirstRunSetup(orgId: string | null, showTutorial: boolean, canManage: boolean) {
  useEffect(() => {
    if (!orgId || !showTutorial || !canManage) return;
    const dismissed = localStorage.getItem(`erp.onboarding.dismissed.${orgId}`) === '1';
    const progress = readProgress(orgId);
    if (progress.done || dismissed) return;
    let live = true;
    api<unknown[]>('/v1/inventory/warehouses')
      .then((rows) => {
        if (live && shouldAutoStart({ showTutorial, canManage, warehouses: Array.isArray(rows) ? rows.length : null, progress, dismissed })) {
          navigate('/start/setup');
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orgId, showTutorial, canManage]);
}

// The home screen: a greeting, then one tile per app the user can open, grouped by suite.
export function Home({ apps }: { apps: AppDef[] }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const timeZone = session.org?.timezone ?? 'UTC';
  const suites = SUITE_ORDER.map((suite) => ({ suite, apps: apps.filter((a) => a.suite === suite) })).filter(
    (s) => s.apps.length > 0,
  );
  const hasBusinessApps = apps.some((a) => a.module !== 'core');
  const canManageApps = hasPermission(session.permissions, 'core.org.manage');
  useFirstRunSetup(session.org?.id ?? null, session.org?.showTutorial === true, canManageApps && hasPermission(session.permissions, 'inventory.items.read'));
  let tileIndex = 0;

  return (
    <section className="home">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t(greeting(timeZone))}</h1>
          <p className="muted">
            <bdi>{session.org?.name}</bdi> · {today(timeZone, lang)}
          </p>
        </div>
        <TourButton />
      </div>

      <div data-tour="home-summary">
        <OwnerSummary />
      </div>

      {!hasBusinessApps && canManageApps && (
        <p className="notice">
          {tr('No business apps are switched on yet.')} <Link to="/settings/apps">{tr('Switch on Inventory')}</Link> {tr('to start managing stock.')}
        </p>
      )}

      {suites.length === 0 && <p className="muted">{t('No apps are available to you yet. Ask an admin for access.')}</p>}
      {suites.map(({ suite, apps }) => (
        <div key={suite} className="suite">
          <h2 className="suite-heading">{t(suite)}</h2>
          <div className="tiles">
            {apps.map((a) => (
              <Link key={a.key} to={a.basePath} className="tile" style={{ '--i': tileIndex++ } as CSSProperties}>
                <span className="tile-icon" aria-hidden="true">
                  <AppIcon appKey={a.key} name={a.name} />
                </span>
                <span className="tile-go" aria-hidden="true">→</span>
                <span className="tile-name">{t(a.name)}</span>
                <span className="tile-desc muted">{t(a.description)}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

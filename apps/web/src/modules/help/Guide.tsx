import { hasPermission } from '@erp/shared';
import { LanguageSwitch } from '../../components/LanguageChooser';
import { Rich } from '../../components/Rich';
import { demoMode } from '../../lib/demo';
import { useI18n } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useSession } from '../../session';
import { SUITE_ORDER, visibleApps } from '../registry';
import { Step } from './GettingStarted';
import { guideContent } from './helpContent';
import { TourButton } from './TourHost';

// The guide: where things are, a five-step path through what the system does, and what is not ready yet. Unlike the getting-started
// tutorial (new companies only), the guide is shown in every organization, including the sample companies. The list of apps is live:
// it shows only the apps this person can open. The wording is in helpContent.ts and follows the person's language (English until they
// choose another); app names and descriptions come from the app registry and are still English.

export function GuidePage() {
  const session = useSession();
  const { lang, t } = useI18n();
  const c = guideContent(lang);
  const apps = visibleApps(session).filter((a) => a.key !== 'guide');
  const suites = SUITE_ORDER.map((suite) => ({ suite, apps: apps.filter((a) => a.suite === suite) })).filter((s) => s.apps.length > 0);
  const has = (key: string) => apps.some((a) => a.key === key);
  const hasAudit = apps.some((a) => a.key === 'settings' && a.pages.some((p) => p.path === '/audit'));

  // Where each step leads (undefined = not available to this person), in the same order as the steps in helpContent.ts.
  const routes: (string | undefined)[] = [
    '/',
    has('inventory') && hasPermission(session.permissions, 'inventory.request.create') ? '/inventory/requests/new' : undefined,
    has('inventory') ? '/inventory/requests' : undefined,
    hasAudit ? '/settings/audit' : undefined,
    has('inventory') && !demoMode ? '/inventory/forecast' : undefined,
  ];

  return (
    <section className="page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="m-0">{c.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <TourButton />
          <LanguageSwitch />
        </div>
      </div>
      <p className="muted">{c.intro}</p>
      {c.draftNote ? <p className="muted small" role="note">{c.draftNote}</p> : null}

      <h2 className="related">{c.whereTitle}</h2>
      <p className="muted small">{c.whereHint}</p>
      {suites.map(({ suite, apps: group }) => (
        <div key={suite} className="stack">
          <strong>{t(suite)}</strong>
          <ul className="plain-list">
            {group.map((a) => (
              <li key={a.key}>
                <Link to={a.basePath}>{t(a.name)}</Link> <span className="muted">: {t(a.description)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <h2 className="related">{c.fiveTitle}</h2>
      <p className="muted small">{c.fiveHint}</p>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {c.steps.map((s, i) => (
          <Step key={i} n={i + 1} title={s.title} to={routes[i]} toLabel={s.toLabel}>
            <Rich text={s.body} />
          </Step>
        ))}
      </ol>

      <h2 className="related">{c.notReadyTitle}</h2>
      <p className="muted small">{c.notReadyHint}</p>
      <ul className="plain-list">
        {c.notReady.map((x, i) => (
          <li key={i}><Rich text={x} /></li>
        ))}
      </ul>
    </section>
  );
}

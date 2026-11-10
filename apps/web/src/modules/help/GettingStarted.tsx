import { useEffect, useState, type ReactNode } from 'react';
import { hasPermission } from '@erp/shared';
import { LanguageChooser, LanguageSwitch } from '../../components/LanguageChooser';
import { Rich } from '../../components/Rich';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import {useI18n, tr } from '../../lib/i18n';
import { Link, navigate } from '../../lib/router';
import { useReloadSession, useSession } from '../../session';
import { tutorialContent } from './helpContent';
import { onboardingContent } from './onboardingContent';
import { TourButton } from './TourHost';

// The getting-started tutorial. It exists only in companies that have the flag `show_tutorial` (sql/032): companies that signed up through
// the app, and any company an owner or admin switches it on for (Settings > General; the cosmetics sample company has it on). The local demo
// build never has it. The checklist is live (it looks at what the company has created so far); the steps describe screens that
// exist today, and the last section says plainly what is not ready yet. Owners and admins can hide it (and bring it back in
// Settings > General).
//
// Language: the tutorial first asks the person to choose English or Arabic (LanguageChooser) and only then shows its text, in that
// language and direction. The words live in helpContent.ts; the routes and the live logic stay here. The choice is the person's own and
// can be changed with the switch on this page or in Settings > General.

/** How many records a list endpoint returns; null = the person may not see it or it is not available. */
function useCount(path: string, enabled: boolean): number | null | undefined {
  const [n, setN] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return setN(null);
    let live = true;
    api<unknown[]>(path).then((rows) => live && setN(Array.isArray(rows) ? rows.length : null)).catch(() => live && setN(null));
    return () => { live = false; };
  }, [path, enabled]);
  return n;
}

export function Step({ n, title, to, toLabel, children }: { n: number; title: string; to?: string; toLabel?: string; children: ReactNode }) {
  const { lang } = useI18n();
  return (
    <li className="flex gap-4 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="m-0 text-base font-semibold">{title}</h3>
        <div className="mt-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
        {to && <p className="mt-3"><Link to={to}>{toLabel ?? (lang === 'ar' ? 'فتح' : tr('Open it'))} {lang === 'ar' ? '←' : '→'}</Link></p>}
      </div>
    </li>
  );
}

// Where each step leads. Language-independent, in the same order as the steps in helpContent.ts.
const STEP_ROUTES = ['/settings', '/settings/users', '/inventory/stock', '/purchasing', '/sales', '/finance/overview', '/accounting/setup', '/inventory/requests', '/alerts', '/inventory/batches'];
const CHECKLIST_ROUTES = ['/settings', '/inventory/stock', '/inventory/stock', '/settings/users', '/purchasing/suppliers', '/sales/customers', '/alerts'];

export function GettingStartedPage() {
  const session = useSession();
  const reload = useReloadSession();
  const { lang, asked } = useI18n();
  const can = (p: string) => hasPermission(session.permissions, p);
  const canHide = can('core.org.manage');
  const warehouses = useCount('/v1/inventory/warehouses', can('inventory.items.read'));
  const items = useCount('/v1/inventory/items', can('inventory.items.read'));
  const team = useCount('/v1/core/members', can('core.users.read'));
  const suppliers = useCount('/v1/purchasing/suppliers', session.modules.includes('purchasing'));
  const customers = useCount('/v1/sales/customers', can('sales.customers.read'));
  const rules = useCount('/v1/alerts/rules', can('alerts.rules.view'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First, the person chooses a language (or the company default). Until they have been asked, nothing else of the tutorial is shown.
  if (!asked) return <section className="page"><LanguageChooser /></section>;

  const c = tutorialContent(lang);
  const wizard = onboardingContent(lang);
  const dones: (boolean | null)[] = [
    true,
    warehouses == null ? null : warehouses > 0,
    items == null ? null : items > 0,
    team == null ? null : team > 1,
    suppliers == null ? null : suppliers > 0,
    customers == null ? null : customers > 0,
    rules == null ? null : rules > 0,
  ];
  // Only steps this person can see or do (UX audit: a worker got "Set up an alert", which opened "Page not found").
  const checklist = c.checklist.map((label, i) => ({ label, done: dones[i] ?? null, to: CHECKLIST_ROUTES[i] ?? '/' })).filter((x, i) => i === 0 || x.done !== null);
  const finished = checklist.filter((x) => x.done === true).length;

  async function hide() {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/core/org/tutorial', { method: 'POST', body: JSON.stringify({ show: false }) });
      reload();
      navigate('/');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="m-0">{c.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <TourButton />
          <LanguageSwitch />
        </div>
      </div>
      <p className="muted">{c.intro(session.org?.name ?? (lang === 'ar' ? 'شركتك' : 'your company'))}</p>
      {c.draftNote ? <p className="muted small" role="note">{c.draftNote}</p> : null}

      {/* The setup wizard is for people who can change the company (UX audit: workers clicked through 8 steps they could not do). */}
      {canHide ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-card p-5 text-card-foreground shadow-xs">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-base font-semibold">{wizard.steps.welcome.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{wizard.welcome.points.join(' · ')}</p>
          </div>
          <Button onClick={() => navigate('/start/setup')}>{wizard.welcome.start}</Button>
        </div>
      ) : null}

      <div className="mt-5 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-base font-semibold">{c.yourSetup}</h2>
          <span className="text-sm text-muted-foreground">{c.doneOf(finished, checklist.length)}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={checklist.length} aria-valuenow={finished} aria-label={c.progressLabel}>
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${(finished / checklist.length) * 100}%` }} />
        </div>
        <ul className="m-0 mt-4 grid list-none gap-2 p-0 sm:grid-cols-2">
          {checklist.map((x) => (
            <li key={x.label}>
              <Link to={x.to} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-foreground no-underline hover:bg-accent">
                <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border text-xs', x.done ? 'border-success bg-success text-white' : 'border-border text-transparent')} aria-hidden="true">✓</span>
                <span className={x.done ? 'text-muted-foreground line-through' : ''}>{x.label}</span>
                <span className="sr-only">{x.done ? c.srDone : x.done === null ? c.srNotAvailable : c.srNotDone}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <ol className="m-0 mt-6 flex list-none flex-col gap-4 p-0">
        {c.steps.map((s, i) => (
          <Step key={i} n={i + 1} title={s.title} to={STEP_ROUTES[i]} toLabel={s.toLabel}>
            <Rich text={s.body} />
          </Step>
        ))}
      </ol>

      <div className="mt-6 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xs">
        <h2 className="m-0 text-base font-semibold">{c.notReadyTitle}</h2>
        <ul className="mt-2 list-disc ps-5 text-sm leading-relaxed text-muted-foreground">
          {c.notReady.map((x, i) => (
            <li key={i}><Rich text={x} /></li>
          ))}
        </ul>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {canHide ? <Button variant="outline" onClick={hide} disabled={busy}>{c.hide}</Button> : null}
        <span className="text-sm text-muted-foreground">{canHide ? c.hideHintCan : c.hideHintCannot}</span>
      </div>
      {error && <p className="error mt-3" role="alert">{error}</p>}
    </section>
  );
}

import { useEffect, useMemo, type ReactNode } from 'react';
import { hasPermission } from '@erp/shared';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import { useI18n, tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { formatWhole } from '../../lib/money';
import { Link, navigate } from '../../lib/router';
import { allLinks, buildSections, recentPaths } from '../../lib/sections';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { readProgress, shouldAutoStart } from '../help/onboardingContent';
import { TourButton } from '../help/TourHost';
import { PageIcon } from '../../components/icons';
import type { AppDef } from '../registry';
import './home.css';

// The home page (new UI plan, 23 Nov 2026; Dynamics 365 way of working): what needs the person, not a launcher of apps (the UX audit
// flagged tiles that copy the menu). Three versions being decided by Ben and Grant, switched in the Design Lab ("Screens being
// decided > Home page"). All read the same data: GET /v1/finance/insights (people allowed to see money), the person's apps and pages.
//   A  Attention list (Dynamics Finance, 2024): a greeting, "N things need you", one line and one action each; key figures beside.
//   B  Role center (Business Central): quick "+ New" actions, 4 key figures, count tiles grouped by section.
//   C  My work, split: the to-do list and recent pages on one side, the figures on the other.
// Every figure and count opens the list behind it.
type Month = { month: string; revenue: number; cogs: number; expenses: number; net: number };
type Insights = {
  currency: string; asOf: string; months: Month[];
  owedToMeMinor: number; overdueMinor: number; iOweMinor: number; stockValueMinor: number; itemsLow: number;
  expiry: Record<'expired' | 'in30' | 'in60' | 'in90', { batches: number; valueMinor: number }>;
  decisions: { submitted: number; approvedNotIssued: number; oldestSubmittedHours: number };
};

// The sample-data build has no money API: it shows these sample figures (that build is marked "sample data" everywhere).
const SAMPLE: Insights = {
  currency: 'EGP', asOf: '', months: [{ month: '2026-11', revenue: 41250000, cogs: 0, expenses: 0, net: 6120000 }],
  owedToMeMinor: 18640000, overdueMinor: 5320000, iOweMinor: 9710000, stockValueMinor: 126500000, itemsLow: 3,
  expiry: { expired: { batches: 1, valueMinor: 120000 }, in30: { batches: 2, valueMinor: 0 }, in60: { batches: 0, valueMinor: 0 }, in90: { batches: 0, valueMinor: 0 } },
  decisions: { submitted: 2, approvedNotIssued: 1, oldestSubmittedHours: 26 },
};
const VERSIONS = ['A', 'B', 'C'] as const;

function greeting(timeZone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
function today(timeZone: string, lang: 'en' | 'ar'): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
}

// First run: a brand-new company is taken to the setup wizard once (unchanged behaviour).
function useFirstRunSetup(orgId: string | null, showTutorial: boolean, canManage: boolean) {
  useEffect(() => {
    if (!orgId || !showTutorial || !canManage) return;
    const dismissed = localStorage.getItem(`erp.onboarding.dismissed.${orgId}`) === '1';
    const progress = readProgress(orgId);
    if (progress.done || dismissed) return;
    let live = true;
    api<unknown[]>('/v1/inventory/warehouses')
      .then((rows) => {
        if (live && shouldAutoStart({ showTutorial, canManage, warehouses: Array.isArray(rows) ? rows.length : null, progress, dismissed })) navigate('/start/setup');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orgId, showTutorial, canManage]);
}

/** One or many: '{n} batch has expired' / '{n} batches have expired'. */
const count = (n: number, one: string, many: string) => trf(n === 1 ? one : many, { n });

type Todo = { key: string; tone: 'bad' | 'watch'; text: string; to: string; action: string };
type Figure = { key: string; label: string; value: string; to: string; note?: string };

function useHomeData(apps: AppDef[]) {
  const session = useSession();
  const can = (p: string) => hasPermission(session.permissions, p);
  const money = can('finance.reports.view');
  const loaded = useLoad(() => (demoMode ? Promise.resolve(SAMPLE) : money ? api<Insights>('/v1/finance/insights') : Promise.resolve(null as Insights | null)));
  const s = loaded.data ?? null;
  const has = (k: string) => apps.some((a) => a.key === k);
  const m = (v: number) => (s ? formatWhole(v, s.currency) : '');
  const todos: Todo[] = [];
  if (s) {
    if (has('inventory') && s.decisions.submitted > 0)
      todos.push({ key: 'approve', tone: 'bad', text: count(s.decisions.submitted, '{n} stock request waits for approval', '{n} stock requests wait for approval'), to: '/inventory/requests', action: tr('Review') });
    if (s.overdueMinor > 0) todos.push({ key: 'overdue', tone: 'watch', text: trf('Customers are late paying {amount}', { amount: m(s.overdueMinor) }), to: '/finance/owed', action: tr('See who') });
    if (has('inventory') && s.itemsLow > 0) todos.push({ key: 'low', tone: 'watch', text: count(s.itemsLow, '{n} item is at or below its reorder level', '{n} items are at or below their reorder level'), to: '/inventory/reorder-levels', action: tr('Order') });
    if (has('inventory') && s.expiry.expired.batches > 0) todos.push({ key: 'expired', tone: 'watch', text: count(s.expiry.expired.batches, '{n} batch has expired', '{n} batches have expired'), to: '/inventory/batches', action: tr('Open') });
    if (has('inventory') && s.decisions.approvedNotIssued > 0) todos.push({ key: 'issue', tone: 'watch', text: count(s.decisions.approvedNotIssued, '{n} approved request is not sent out yet', '{n} approved requests are not sent out yet'), to: '/inventory/requests', action: tr('Send out') });
  }
  const last = s?.months[s.months.length - 1];
  const figures: Figure[] = s
    ? [
        { key: 'sales', label: tr('Sales this month'), value: m(last?.revenue ?? 0), to: '/finance/overview' },
        { key: 'owed', label: tr('Customers owe you'), value: m(s.owedToMeMinor), to: '/finance/owed', note: s.overdueMinor > 0 ? trf('{amount} late', { amount: m(s.overdueMinor) }) : undefined },
        { key: 'iowe', label: tr('You owe suppliers'), value: m(s.iOweMinor), to: '/finance/owed' },
        { key: 'stock', label: tr('Stock value'), value: m(s.stockValueMinor), to: '/inventory/stock' },
      ]
    : [];
  // Quick actions: the create pages this person can open, in a fixed order.
  const order = ['/sales/orders/new', '/purchasing/orders/new', '/inventory/receive', '/inventory/requests/new', '/inventory/transfers/new'];
  const pages = apps.flatMap((a) => a.pages.map((p) => ({ a, p, to: a.basePath + p.path })));
  const quick = order.map((to) => pages.find((x) => x.to === to)).filter((x): x is (typeof pages)[number] => !!x);
  return { s, todos, figures, quick, loading: loaded.loading, error: loaded.error, sample: demoMode };
}

function Figures({ figures, compact }: { figures: Figure[]; compact?: boolean }) {
  return (
    <div className={compact ? 'hm-figs hm-figs-compact' : 'hm-figs'}>
      {figures.map((f) => (
        <Link key={f.key} to={f.to} className="hm-fig">
          <span className="hm-fig-label">{f.label}</span>
          <span className="hm-fig-value">{f.value}</span>
          {f.note && <span className="hm-fig-note">{f.note}</span>}
        </Link>
      ))}
    </div>
  );
}

function TodoList({ todos }: { todos: Todo[] }) {
  if (!todos.length) return <p className="hm-empty">{tr('Nothing needs you right now.')}</p>;
  return (
    <ul className="hm-todos">
      {todos.map((t) => (
        <li key={t.key} className={`hm-todo hm-${t.tone}`}>
          <span className="hm-todo-dot" aria-hidden="true" />
          <span className="hm-todo-text">{t.text}</span>
          <Link to={t.to} className="hm-todo-go">{t.action}</Link>
        </li>
      ))}
    </ul>
  );
}

export function Home({ apps }: { apps: AppDef[] }) {
  const { t, lang } = useI18n();
  const session = useSession();
  const timeZone = session.org?.timezone ?? 'UTC';
  const version = useLabChoice('home', VERSIONS, 'A');
  const canManageApps = hasPermission(session.permissions, 'core.org.manage');
  useFirstRunSetup(session.org?.id ?? null, session.org?.showTutorial === true, canManageApps && hasPermission(session.permissions, 'inventory.items.read'));
  const d = useHomeData(apps);
  const sections = useMemo(() => buildSections(apps), [apps]);
  const links = useMemo(() => allLinks(sections), [sections]);
  const recent = recentPaths().map((p) => links.find((l) => l.to === p)).filter((l): l is (typeof links)[number] => !!l).slice(0, 5);
  const first = (session.name ?? '').split(' ')[0];
  const hello = first ? `${t(greeting(timeZone))}, ${first}` : t(greeting(timeZone));
  const noApps = !apps.some((a) => a.module !== 'core');

  const head = (
    <header className="hm-head">
      <div>
        <p className="hm-date">{today(timeZone, lang)} · <bdi>{session.org?.name}</bdi></p>
        <h1>{hello}</h1>
        {version === 'A' && d.s && (
          <p className="hm-lead">{d.todos.length ? count(d.todos.length, '{n} thing needs you today.', '{n} things need you today.') : tr('Nothing needs you right now.')}</p>
        )}
      </div>
      <TourButton />
    </header>
  );
  const quick = d.quick.length > 0 && (
    <div className="hm-quick">
      {d.quick.map((q) => (
        <Link key={q.to} to={q.to} className="hm-qbtn"><span className="hm-plus" aria-hidden="true">+</span>{t(q.p.label)}</Link>
      ))}
    </div>
  );
  const sampleNote = d.sample && <p className="hm-sample">{tr('Sample figures (demo).')}</p>;
  const noMoney = !d.s && !d.loading && (
    <p className="hm-empty">{tr('Your figures and to-dos show here for people allowed to see money.')}</p>
  );

  let body: ReactNode;
  if (version === 'B') {
    // Count tiles grouped by section; each opens the list behind it.
    const tiles: { group: string; items: { label: string; n: string; to: string }[] }[] = d.s
      ? [
          { group: tr('Stock'), items: [{ label: tr('Requests to approve'), n: String(d.s.decisions.submitted), to: '/inventory/requests' }, { label: tr('Approved, not sent out'), n: String(d.s.decisions.approvedNotIssued), to: '/inventory/requests' }, { label: tr('Items low'), n: String(d.s.itemsLow), to: '/inventory/reorder-levels' }, { label: tr('Expired batches'), n: String(d.s.expiry.expired.batches), to: '/inventory/batches' }] },
          { group: tr('Money'), items: [{ label: tr('Late customer money'), n: formatWhole(d.s.overdueMinor, d.s.currency), to: '/finance/owed' }, { label: tr('Expiring in 30 days'), n: String(d.s.expiry.in30.batches), to: '/inventory/batches' }] },
        ]
      : [];
    body = (
      <>
        {quick && <section className="hm-box"><h2 className="hm-h2">{tr('Actions')}</h2>{quick}</section>}
        {d.s && <section className="hm-box"><h2 className="hm-h2">{tr('Activities')}</h2><Figures figures={d.figures} /></section>}
        {tiles.map((g) => (
          <section key={g.group} className="hm-counts-group">
            <h2 className="hm-h2">{g.group}</h2>
            <ul className="hm-counts">
              {g.items.map((i) => (
                <li key={i.label}><Link to={i.to} className="hm-count"><span>{i.label}</span><span className="hm-count-n">{i.n}</span></Link></li>
              ))}
            </ul>
          </section>
        ))}
        {noMoney}
      </>
    );
  } else if (version === 'C') {
    body = (
      <div className="hm-split">
        <section className="hm-col">
          <h2 className="hm-h2">{tr('My work')}</h2>
          {d.s ? <TodoList todos={d.todos} /> : noMoney}
          {quick && <><h2 className="hm-h2">{tr('Start something')}</h2>{quick}</>}
          <h2 className="hm-h2">{tr('Continue where you left off')}</h2>
          {recent.length ? (
            <ul className="hm-recent">
              {recent.map((l) => (
                <li key={l.to}><Link to={l.to}><span className="hm-recent-icon"><PageIcon appKey={l.app.key} path={l.page.path} /></span>{t(l.page.label)}<span className="hm-recent-app">{t(l.app.name)}</span></Link></li>
              ))}
            </ul>
          ) : <p className="hm-empty">{tr('Pages you open will show here.')}</p>}
        </section>
        <aside className="hm-col hm-col-side">
          <h2 className="hm-h2">{tr('Your business')}</h2>
          {d.s && <Figures figures={d.figures} compact />}
        </aside>
      </div>
    );
  } else {
    body = (
      <div className="hm-attn">
        <section className="hm-attn-main">
          {d.s ? <TodoList todos={d.todos} /> : noMoney}
          {quick && <><h2 className="hm-h2">{tr('Start something')}</h2>{quick}</>}
        </section>
        {d.s && <aside className="hm-attn-side"><Figures figures={d.figures} compact /></aside>}
      </div>
    );
  }

  return (
    <section className={`home hm hm-${version.toLowerCase()}`}>
      {head}
      <div data-tour="home-summary">{body}</div>
      {sampleNote}
      {noApps && canManageApps && (
        <p className="notice">{tr('No business apps are switched on yet.')} <Link to="/settings/apps">{tr('Switch on Inventory')}</Link> {tr('to start managing stock.')}</p>
      )}
    </section>
  );
}

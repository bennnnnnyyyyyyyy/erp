import { Suspense, useMemo, useState } from 'react';
import { Loading } from '../../components/Loading';
import { tr } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { Link } from '../../lib/router';
import { useSession } from '../../session';
import { visibleApps, type AppPage } from '../registry';
import '../sales/pagekit.css';

// New UI (plan of 23 Nov 2026): how people find their way through Settings, in three versions (Design Lab "Settings"). The settings
// pages themselves are unchanged; this page only lists the ones the person may open (visibleApps: permissions and modules).
//   A  Grouped list (Dynamics): Company, People, Documents and data, Records; one row per setting with a line that says what it is.
//   B  Two panes: the list stays on one side; the chosen settings page opens beside it.
//   C  Search first: "Find a setting", then one short list that filters as you type.
const VERSIONS = ['A', 'B', 'C'] as const;
const ABOUT: Record<string, { group: string; text: string }> = {
  '': { group: 'Company', text: 'Name, language, currency, time zone, VAT and company options.' },
  '/branches': { group: 'Company', text: 'Branches and where each one works.' },
  '/apps': { group: 'Company', text: 'Switch modules on or off for the whole company.' },
  '/users': { group: 'People', text: 'Invite people, set their role, remove access.' },
  '/me': { group: 'People', text: 'Your own language, phone for WhatsApp, and password.' },
  '/documents': { group: 'Documents and data', text: 'Logo, letterhead and texts on invoices and notes.' },
  '/import': { group: 'Documents and data', text: 'Bring in items, customers or suppliers from a CSV or Excel file.' },
  '/integrations': { group: 'Documents and data', text: 'Connect WhatsApp, the e-invoice portal, a store, payments.' },
  '/audit': { group: 'Records', text: 'Every change and decision, who made it and when. Nobody can change it.' },
};
const GROUP_ORDER = ['Company', 'People', 'Documents and data', 'Records'];

export function SettingsNew() {
  const version = useLabChoice('settings', VERSIONS, 'A');
  const session = useSession();
  const app = visibleApps(session).find((a) => a.key === 'settings');
  const pages = (app?.pages ?? []).filter((p) => p.nav !== false && p.path !== '/all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AppPage | null>(null);
  const label = (p: AppPage) => tr(p.label);
  const text = (p: AppPage) => tr(ABOUT[p.path]?.text ?? '');
  const groups = useMemo(
    () => GROUP_ORDER.map((g) => ({ g, ps: pages.filter((p) => (ABOUT[p.path]?.group ?? 'Records') === g) })).filter((x) => x.ps.length),
    [pages],
  );
  const row = (p: AppPage, onClick?: () => void) => (
    <li key={p.path}>
      {onClick ? (
        <button type="button" className={open?.path === p.path ? 'st-row active' : 'st-row'} onClick={onClick}>
          <span className="st-name">{label(p)}</span><span className="st-text">{text(p)}</span>
        </button>
      ) : (
        <Link to={`/settings${p.path}`} className="st-row">
          <span className="st-name">{label(p)}</span><span className="st-text">{text(p)}</span><span className="st-go" aria-hidden="true">›</span>
        </Link>
      )}
    </li>
  );

  if (version === 'B') {
    const cur = open ?? pages[0] ?? null;
    const Page = cur?.component;
    return (
      <section className="page pk pk-wide st-b">
        <div className="pk-head"><h1>{tr('Settings')}</h1></div>
        <div className="st-panes">
          <nav aria-label={tr('Settings')}>
            {groups.map(({ g, ps }) => (
              <div key={g}><p className="pk-h2">{tr(g)}</p><ul className="st-list">{ps.map((p) => row(p, () => setOpen(p)))}</ul></div>
            ))}
          </nav>
          <div className="st-pane">{Page ? <Suspense fallback={<Loading />}><Page /></Suspense> : null}</div>
        </div>
      </section>
    );
  }
  if (version === 'C') {
    const s = q.trim().toLowerCase();
    const hits = pages.filter((p) => !s || label(p).toLowerCase().includes(s) || text(p).toLowerCase().includes(s)).sort((a, b) => label(a).localeCompare(label(b)));
    return (
      <section className="page pk st-c">
        <div className="pk-head"><h1>{tr('Settings')}</h1></div>
        <input className="st-search" type="search" autoFocus aria-label={tr('Find a setting')} placeholder={tr('Find a setting, for example "VAT" or "logo"')} value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="st-list">{hits.map((p) => row(p))}</ul>
        {hits.length === 0 && <p className="pk-empty">{tr('No setting matches. Try another word.')}</p>}
      </section>
    );
  }
  return (
    <section className="page pk st-a">
      <div className="pk-head"><h1>{tr('Settings')}</h1></div>
      {groups.map(({ g, ps }) => (
        <section key={g}><h2 className="pk-h2">{tr(g)}</h2><ul className="st-list">{ps.map((p) => row(p))}</ul></section>
      ))}
    </section>
  );
}

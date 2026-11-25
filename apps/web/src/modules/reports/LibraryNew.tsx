import { useState } from 'react';
import type { SavedReport } from '@erp/shared';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { Link, navigate } from '../../lib/router';
import { useReportLibrary } from './Library';
import type { ShownReport } from './reportLibrary';
import '../sales/pagekit.css';
import './reports-new.css';

// New UI (24 Nov 2026): the report library in three versions, Design Lab "Report library". No tiles (Ben: seamless, hairlines). Same
// rules as the old page (useReportLibrary): a report shows only when the person can already open it; saved reports and ready-made
// reports come from the same API.
//   A  Dynamics explorer: areas on the start side with counts, the area's reports as rows, the chosen report in a side panel.
//   B  One list: a big search, then every report as one row (name, what it answers, area), your saved reports first.
//   C  Columns: every area side by side, names only, so the whole library fits on one screen.
const VERSIONS = ['A', 'B', 'C'] as const;
type Row = { key: string; title: string; description: string; to: string; area: string; kind: 'screen' | 'ready' | 'mine' | 'company' };

export function ReportLibraryNew() {
  const version = useLabChoice('rlib', VERSIONS, 'A');
  const lib = useReportLibrary();
  const fromSaved = (r: SavedReport, kind: 'mine' | 'company'): Row => ({ key: `s:${r.id}`, title: r.name, description: r.description ?? '', to: `/reports/${r.id}`, area: kind === 'mine' ? 'My reports' : 'Company reports', kind });
  const fromShown = (r: ShownReport, area: string): Row => ({ key: r.path, title: tr(r.title), description: tr(r.description), to: r.path, area, kind: r.ready ? 'ready' : 'screen' });
  const groups: { key: string; label: string; rows: Row[] }[] = [
    ...(lib.mine.length ? [{ key: 'mine', label: 'My reports', rows: lib.mine.map((r) => fromSaved(r, 'mine')) }] : []),
    ...(lib.company.length ? [{ key: 'company', label: 'Company reports', rows: lib.company.map((r) => fromSaved(r, 'company')) }] : []),
    ...lib.areas.map((a) => ({ key: a.key, label: a.label, rows: a.reports.map((r) => fromShown(r, a.label)) })),
  ];
  const all = groups.flatMap((g) => g.rows);
  const [areaKey, setAreaKey] = useState<string>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const kindLabel = (k: Row['kind']) => (k === 'ready' ? tr('Ready-made') : k === 'mine' ? tr('My reports') : k === 'company' ? tr('Company reports') : tr('Screen'));

  const head = (
    <div className="pk-head">
      <div><p className="pk-kind">{tr('Reports & Insights')}</p><h1>{tr('Report library')}</h1></div>
      {lib.canBuild ? <Link to="/reports/new" className="pk-act pk-act-main rl-new">+ {tr('New report')}</Link> : null}
    </div>
  );
  const search = (big = false) => (
    <input type="search" className={big ? 'st-search' : 'pk-search'} value={lib.search} onChange={(e) => lib.setSearch(e.target.value)}
      placeholder={tr('For example: VAT, stock, owed')} aria-label={tr('Find a report')} />
  );
  // Dead ends (Ben, 25 Nov): an empty list says why and offers the step that fills it.
  const empty = !lib.anyAtAll
    ? (
      <div className="pk-empty">
        <p>{tr('No reports are open to you yet. Ask an admin for access.')}</p>
        <p className="pk-muted">{tr('A report shows when you can open the page its data comes from. An owner or admin gives access in Settings → Users.')}</p>
      </div>
    )
    : all.length === 0 && lib.q
      ? <p className="pk-empty">{tr('No report matches your search.')} <button type="button" className="pk-link" onClick={() => lib.setSearch('')}>{tr('Clear the search')}</button></p>
      : null;
  const noneSaved = lib.canBuild && !lib.q && lib.mine.length === 0
    ? <p className="pk-muted rl-hint">{tr('You have no saved reports yet. Open a report, change it, and press Save: it shows here under "My reports".')}</p>
    : null;

  if (version === 'B') {
    return (
      <section className="page pk rl rl-b">
        {head}
        {search(true)}
        {empty}{noneSaved}
        {groups.map((g) => (
          <section key={g.key} className="rl-group">
            <h2 className="pk-h2">{tr(g.label)} <span className="pk-group-n">{g.rows.length}</span></h2>
            <ul className="rl-rows">
              {g.rows.map((r) => (
                <li key={r.key}>
                  <Link to={r.to} className="rl-row">
                    <span className="rl-title">{r.title}{r.kind === 'ready' ? <span className="rl-tag">{tr('Ready-made')}</span> : null}</span>
                    <span className="rl-desc">{r.description}</span>
                    <span className="rl-go" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    );
  }

  if (version === 'C') {
    return (
      <section className="page pk pk-wide rl rl-c">
        {head}
        <div className="pk-bar">{search()}<span className="pk-bar-gap" /><span className="pk-muted">{trf('{n} reports', { n: all.length })}</span></div>
        {empty}{noneSaved}
        <div className="rl-cols">
          {groups.map((g) => (
            <section key={g.key} className="rl-col">
              <h2>{tr(g.label)}</h2>
              <ul>
                {g.rows.map((r) => (
                  <li key={r.key}><Link to={r.to} title={r.description}>{r.title}</Link>{r.kind === 'ready' ? <span className="rl-dot" title={tr('Ready-made')}>•</span> : null}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="pk-muted rl-legend"><span className="rl-dot">•</span> {tr('Ready-made: opens in the report builder, where you can change it and save your own copy.')}</p>
      </section>
    );
  }

  // A
  const shownGroup = areaKey === 'all' ? null : groups.find((g) => g.key === areaKey) ?? null;
  const rows = shownGroup ? shownGroup.rows : all;
  const sel = rows.find((r) => r.key === picked) ?? null;
  return (
    <section className="page pk pk-wide rl rl-a">
      {head}
      <div className="pk-bar">{search()}<span className="pk-bar-gap" /><span className="pk-muted">{trf('{n} reports', { n: rows.length })}</span></div>
      {empty}{noneSaved}
      <div className="rl-explorer">
        <nav className="rl-areas" aria-label={tr('Areas')}>
          <button type="button" className={`st-row${areaKey === 'all' ? ' active' : ''}`} onClick={() => { setAreaKey('all'); setPicked(null); }}>
            <span className="st-name">{tr('All reports')}</span><span className="pk-group-n">{all.length}</span>
          </button>
          {groups.map((g) => (
            <button key={g.key} type="button" className={`st-row${areaKey === g.key ? ' active' : ''}`} onClick={() => { setAreaKey(g.key); setPicked(null); }}>
              <span className="st-name">{tr(g.label)}</span><span className="pk-group-n">{g.rows.length}</span>
            </button>
          ))}
        </nav>
        <div className="pk-table-wrap">
          <table className="pk-table">
            <thead><tr><th scope="col">{tr('Report')}</th><th scope="col">{tr('What it answers')}</th>{areaKey === 'all' ? <th scope="col">{tr('Area')}</th> : null}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={picked === r.key ? 'pk-sel' : undefined} onClick={() => setPicked(r.key)} onDoubleClick={() => navigate(r.to)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(r.to); }}>
                  <td><strong>{r.title}</strong>{r.kind === 'ready' ? <span className="rl-tag">{tr('Ready-made')}</span> : null}</td>
                  <td className="pk-muted-cell">{r.description}</td>
                  {areaKey === 'all' ? <td className="pk-muted-cell">{tr(r.area)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="pk-side rl-side">
          {sel ? (
            <>
              <p className="pk-label">{kindLabel(sel.kind)}</p>
              <p className="pk-side-title">{sel.title}</p>
              <p className="pk-muted">{sel.description}</p>
              <Link to={sel.to} className="pk-act pk-act-main rl-open">{sel.kind === 'ready' || sel.kind === 'mine' || sel.kind === 'company' ? tr('Open and run') : tr('Open')}</Link>
              {sel.kind === 'ready' ? <p className="pk-muted">{tr('Opens in the report builder, where you can change it and save your own copy.')}</p> : null}
            </>
          ) : (
            <p className="pk-muted">{tr('Choose a report to see what it shows. Double-click or press Enter to open it.')}</p>
          )}
        </aside>
      </div>
    </section>
  );
}

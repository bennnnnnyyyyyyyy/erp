import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ReportSource, SavedReport } from '@erp/shared';
import { PageIcon } from '../../components/icons';
import { buttonVariants } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { tr } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useSession } from '../../session';
import { resolveRoute, visibleApps } from '../registry';
import { libraryFor } from './reportLibrary';

// Reports & Insights (REPORTS_INSIGHTS_PLAN.md). Step 1: the report library. Every report that exists today, grouped by area, as links
// to the existing screens. A card shows only when this person can open that page already: the same check the menu uses (module on,
// page permission held), so the library never shows more than the menu does. Uses the home page's suite and tile styles.
// Step 2: the saved reports this person can see and run ("My reports", "Company reports"), and "New report" (the builder). Before
// sql/109 is applied the API answers 503 and these simply do not show.

/** The library's logic, shared by this page and the new-UI versions (LibraryNew): who may open what, the saved reports, the search. */
export function useReportLibrary() {
  const session = useSession();
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [sourceKeys, setSourceKeys] = useState<ReadonlySet<string>>(new Set());
  const apps = useMemo(() => visibleApps(session), [session]);
  const canOpen = useMemo(
    () => (path: string) => {
      const r = resolveRoute(path, apps);
      // Only the exact page: resolveRoute falls back to an app's first page, which would be a different report.
      return r?.page && `${r.app.basePath}${r.page.path}` === path ? r.page.label : null;
    },
    [apps],
  );
  const canBuild = canOpen('/reports/new') !== null;
  useEffect(() => {
    if (!canBuild) return;
    let live = true;
    // Not set up yet (sql/109), or nothing to show: the library still works without these.
    api<SavedReport[]>('/v1/reports/saved')
      .then((r) => live && setSaved(r))
      .catch(() => undefined);
    // Step 3: the ready-made reports on the sources this person may use.
    api<ReportSource[]>('/v1/reports/sources')
      .then((s) => live && setSourceKeys(new Set(s.map((x) => x.key))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [canBuild]);

  const areas = libraryFor(canOpen, search, tr, sourceKeys);
  const q = search.trim().toLocaleLowerCase();
  const shownSaved = saved.filter((r) => !q || `${r.name} ${r.description ?? ''}`.toLocaleLowerCase().includes(q));
  const mine = shownSaved.filter((r) => r.visibility === 'private');
  const company = shownSaved.filter((r) => r.visibility === 'company');
  const anyAtAll = libraryFor(canOpen).length > 0 || saved.length > 0 || canBuild;
  return { search, setSearch, apps, canOpen, canBuild, areas, q, shownSaved, mine, company, anyAtAll };
}

export function ReportLibraryPage() {
  const { search, setSearch, apps, canBuild, areas, q, shownSaved, mine, company, anyAtAll } = useReportLibrary();
  let tileIndex = 0;

  const savedTiles = (list: SavedReport[]) => (
    <div className="tiles">
      {list.map((r) => (
        <Link key={r.id} to={`/reports/${r.id}`} className="tile" style={{ '--i': tileIndex++ } as CSSProperties}>
          <span className="tile-icon" aria-hidden="true"><PageIcon appKey="reports" path="" /></span>
          <span className="tile-go" aria-hidden="true">→</span>
          <span className="tile-name">{r.name}</span>
          {r.description && <span className="tile-desc muted">{r.description}</span>}
        </Link>
      ))}
    </div>
  );

  return (
    <section className="page">
      <h1>{tr('Report library')}</h1>
      <p className="muted">{tr('Every report in one place, by area. You see the reports you are allowed to open.')}</p>
      {anyAtAll && (
        <div className="form-row">
          <label>
            {tr('Find a report')}
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('For example: VAT, stock, owed')} />
          </label>
          {canBuild && <Link to="/reports/new" className={cn(buttonVariants(), 'no-underline')}>{tr('New report')}</Link>}
        </div>
      )}
      {!anyAtAll && <p className="muted">{tr('No reports are open to you yet. Ask an admin for access.')}</p>}
      {anyAtAll && areas.length === 0 && shownSaved.length === 0 && q && <p className="muted">{tr('No report matches your search.')}</p>}
      {mine.length > 0 && (
        <div className="suite">
          <h2 className="suite-heading">{tr('My reports')}</h2>
          {savedTiles(mine)}
        </div>
      )}
      {company.length > 0 && (
        <div className="suite">
          <h2 className="suite-heading">{tr('Company reports')}</h2>
          {savedTiles(company)}
        </div>
      )}
      {areas.map((area) => (
        <div key={area.key} className="suite">
          <h2 className="suite-heading">{tr(area.label)}</h2>
          <div className="tiles">
            {area.reports.map((r) => {
              const app = resolveRoute(r.path, apps)?.app;
              return (
                <Link key={r.path} to={r.path} className="tile" style={{ '--i': tileIndex++ } as CSSProperties}>
                  <span className="tile-icon" aria-hidden="true">
                    <PageIcon appKey={app?.key ?? ''} path={app ? r.path.slice(app.basePath.length) : r.path} />
                  </span>
                  <span className="tile-go" aria-hidden="true">→</span>
                  <span className="tile-name">{tr(r.title)}</span>
                  <span className="tile-desc muted">{r.ready ? `${tr('Ready-made')} · ` : ''}{tr(r.description)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

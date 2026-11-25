import { useEffect, useMemo, useState } from 'react';
import type { ReportSource, SavedReport } from '@erp/shared';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr } from '../../lib/i18n';
import { Link, navigate } from '../../lib/router';
import { useSession } from '../../session';
import { resolveRoute, visibleApps } from '../registry';
import { libraryFor } from './reportLibrary';

// Reports & Insights (REPORTS_INSIGHTS_PLAN.md). Step 1: the report library. Every report that exists today, grouped by area, as links
// to the existing screens. A card shows only when this person can open that page already: the same check the menu uses (module on,
// page permission held), so the library never shows more than the menu does. Uses the home page's suite and tile styles.
// Step 2: the saved reports this person can see and run ("My reports", "Company reports"), and "New report" (the builder). Before
// sql/109 is applied the API answers 503 and these simply do not show.

export function ReportLibraryPage() {
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
  // A calm list by area (declutter, Ben 25 Nov 2026): each report is its name and one short line; ready-made reports carry a small
  // badge instead of repeating "Ready-made" in every description. No icons or boxed tiles.
  const savedList = (list: SavedReport[]) => (
    <ul className="report-list">
      {list.map((r) => (
        <li key={r.id}>
          <Link to={`/reports/${r.id}`} className="report-link">{r.name}</Link>
          {r.description && <span className="muted small">{r.description}</span>}
        </li>
      ))}
    </ul>
  );

  return (
    <section className="page">
      <div className="rb-head">
        <div className="rb-title">
          <h1>{tr('Report library')}</h1>
          <p className="muted">{tr('Every report in one place, by area. You see the reports you are allowed to open.')}</p>
        </div>
        {canBuild && <div className="rb-head-actions"><Button onClick={() => navigate('/reports/new')}>{tr('New report')}</Button></div>}
      </div>
      {anyAtAll && (
        <label className="report-search">
          <span className="sr-only">{tr('Find a report')}</span>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Find a report')} aria-label={tr('Find a report')} />
        </label>
      )}
      {!anyAtAll && <p className="muted">{tr('No reports are open to you yet. Ask an admin for access.')}</p>}
      {anyAtAll && areas.length === 0 && shownSaved.length === 0 && q && <p className="muted">{tr('No report matches your search.')}</p>}
      {mine.length > 0 && (
        <section className="report-area">
          <h2>{tr('My reports')}</h2>
          {savedList(mine)}
        </section>
      )}
      {company.length > 0 && (
        <section className="report-area">
          <h2>{tr('Company reports')}</h2>
          {savedList(company)}
        </section>
      )}
      {areas.map((area) => (
        <section key={area.key} className="report-area">
          <h2>{tr(area.label)}</h2>
          <ul className="report-list">
            {area.reports.map((r) => (
              <li key={r.path}>
                <span className="report-link-row">
                  <Link to={r.path} className="report-link">{tr(r.title)}</Link>
                  {r.ready && <Badge variant="neutral">{tr('Ready-made')}</Badge>}
                </span>
                <span className="muted small">{tr(r.description)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

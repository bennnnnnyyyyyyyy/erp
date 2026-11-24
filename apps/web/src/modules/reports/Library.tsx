import { useMemo, useState, type CSSProperties } from 'react';
import { PageIcon } from '../../components/icons';
import { tr } from '../../lib/i18n';
import { Link } from '../../lib/router';
import { useSession } from '../../session';
import { resolveRoute, visibleApps } from '../registry';
import { libraryFor } from './reportLibrary';

// Reports & Insights, step 1 (REPORTS_INSIGHTS_PLAN.md): the report library. Every report that exists today, grouped by area, as links to
// the existing screens. A card shows only when this person can open that page already: the same check the menu uses (module on, page
// permission held), so the library never shows more than the menu does. Uses the home page's suite and tile styles.

export function ReportLibraryPage() {
  const session = useSession();
  const [search, setSearch] = useState('');
  const apps = useMemo(() => visibleApps(session), [session]);
  const canOpen = useMemo(
    () => (path: string) => {
      const r = resolveRoute(path, apps);
      // Only the exact page: resolveRoute falls back to an app's first page, which would be a different report.
      return r?.page && `${r.app.basePath}${r.page.path}` === path ? r.page.label : null;
    },
    [apps],
  );
  const areas = libraryFor(canOpen, search, tr);
  const anyAtAll = libraryFor(canOpen).length > 0;
  let tileIndex = 0;

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
        </div>
      )}
      {!anyAtAll && <p className="muted">{tr('No reports are open to you yet. Ask an admin for access.')}</p>}
      {anyAtAll && areas.length === 0 && <p className="muted">{tr('No report matches your search.')}</p>}
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
                  <span className="tile-desc muted">{tr(r.description)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

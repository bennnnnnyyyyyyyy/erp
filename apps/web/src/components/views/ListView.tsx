import { useMemo, useState, type ReactNode } from 'react';

// The shared List view every module uses for a table of records: quick search, column sort and
// CSV export of the rows shown. Sorting and search run in the browser for now; large tables
// will move both to the API with the same props.

export type Column<T> = {
  key: string;
  label: string;
  /** Plain value used for sort, search and CSV. */
  value: (row: T) => string | number | null;
  /** Optional cell rendering; defaults to the plain value. */
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
};

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Used for the CSV file name. */
  title: string;
  empty?: string;
  toolbar?: ReactNode;
  actions?: (row: T) => ReactNode;
};

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ListView<T>({ rows, columns, rowKey, title, empty, toolbar, actions }: Props<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q
      ? rows.filter((r) => columns.some((c) => String(c.value(r) ?? '').toLowerCase().includes(q)))
      : [...rows];
    const col = sort && columns.find((c) => c.key === sort.key);
    if (col && sort) {
      out = out.sort((a, b) => {
        const x = col.value(a) ?? '';
        const y = col.value(b) ?? '';
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    }
    return out;
  }, [rows, columns, query, sort]);

  function toggleSort(key: string) {
    setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  }

  function exportCsv() {
    const lines = [columns.map((c) => csvCell(c.label)).join(',')];
    for (const r of shown) lines.push(columns.map((c) => csvCell(c.value(r))).join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="list-view">
      <div className="list-toolbar">
        <input
          className="list-search"
          type="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`Search ${title}`}
        />
        <span className="muted list-count">
          {shown.length} of {rows.length}
        </span>
        <span className="spacer" />
        {toolbar}
        <button className="secondary" onClick={exportCsv} disabled={shown.length === 0}>
          Export CSV
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align === 'right' ? 'right' : undefined}>
                  <button className="th-sort" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
              {actions && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'right' ? 'right' : undefined}>
                    {c.render ? c.render(r) : c.value(r)}
                  </td>
                ))}
                {actions && <td className="row-actions">{actions(r)}</td>}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns.length + (actions ? 1 : 0)} className="muted empty">
                  {rows.length === 0 ? (empty ?? 'Nothing here yet.') : 'No matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { hasPermission } from '@erp/shared';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api, ApiError } from '../../../lib/api';
import { tr, trf } from '../../../lib/i18n';
import {
  buildImportRows,
  guessImportMapping,
  IMPORT_FIELDS,
  type ImportField,
  type ImportKind,
  type ImportMapping,
  type ImportRow,
  importEndpoint,
  importPermission,
  MAX_IMPORT_ROWS,
  templateCsv,
} from '../../../lib/importRows';
import { readStatementFile, StatementFileError } from '../../../lib/statementFiles';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';

// Settings > Import from a file (Sheets option A). A person saves their sheet as CSV or Excel and uploads it here: the file is read in
// the browser, the columns are matched, the rows are checked, and then each row is sent to the same API route the normal screen uses
// (so unique codes, cost with opening stock and permissions are all checked by the database as usual). Pure logic: lib/importRows.ts.

type Warehouse = { id: string; code?: string; name: string };
type Outcome = { state: 'done' } | { state: 'failed'; error: string };

const KIND_LABEL: Record<ImportKind, string> = { items: 'Items (with opening stock)', customers: 'Customers', suppliers: 'Suppliers' };
const PREVIEW_ROWS = 20;

function downloadTemplate(kind: ImportKind) {
  const url = URL.createObjectURL(new Blob([`﻿${templateCsv(kind)}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${kind}-template.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const problemText = (p: ImportRow['problems'][number]) => (p.line === undefined ? tr(p.text) : trf(p.text, { line: p.line }));

export function ImportFromFile() {
  const session = useSession();
  const kinds = (Object.keys(KIND_LABEL) as ImportKind[]).filter((k) => hasPermission(session.permissions, importPermission[k]) && (k !== 'items' || session.modules.includes('inventory')));
  const [kind, setKind] = useState<ImportKind | null>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<number, Outcome>>({});
  const [sent, setSent] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const warehouses = useLoad(() => (session.modules.includes('inventory') ? api<Warehouse[]>('/v1/inventory/warehouses') : Promise.resolve([] as Warehouse[])));
  const active = kind && kinds.includes(kind) ? kind : (kinds[0] ?? null);
  const wh = warehouseId || warehouses.data?.[0]?.id || '';

  const built = useMemo(() => (active && rows && mapping ? buildImportRows(active, rows, mapping, wh) : []), [active, rows, mapping, wh]);

  if (!warehouses.data) return <section className="page"><Loading error={warehouses.error} /></section>;
  if (!active) return <section className="page"><h1>{tr('Import from a file')}</h1><p className="muted">{tr('You do not have permission to import anything.')}</p></section>;

  const reset = () => {
    setRows(null);
    setMapping(null);
    setFileName('');
    setOutcomes({});
    setSent(null);
    setError(null);
  };

  async function choose(f: File | undefined) {
    reset();
    if (!f || !active) return;
    try {
      const read = await readStatementFile(f);
      if (read.kind !== 'rows' || read.format === 'docx') throw new StatementFileError('Only CSV and Excel (.xlsx) files can be imported here.');
      if (read.rows.length - 1 > MAX_IMPORT_ROWS) throw new StatementFileError('A file can hold up to {max} rows. Split it and import the parts one by one.');
      setRows(read.rows);
      setFileName(read.name);
      setMapping(guessImportMapping(active, read.rows));
    } catch (e) {
      setError(e instanceof StatementFileError ? trf(e.message, { max: MAX_IMPORT_ROWS }) : (e as Error).message);
    }
  }

  const ready = built.filter((r) => r.body && outcomes[r.line]?.state !== 'done');
  const withProblems = built.filter((r) => !r.body);
  const done = built.filter((r) => outcomes[r.line]?.state === 'done').length;
  const failed = built.filter((r) => outcomes[r.line]?.state === 'failed');

  async function send() {
    if (!active) return;
    setRunning(true);
    setError(null);
    let count = 0;
    setSent({ done: 0, total: ready.length });
    for (const r of ready) {
      let outcome: Outcome = { state: 'done' };
      try {
        await api(importEndpoint[active], { method: 'POST', body: JSON.stringify(r.body) });
      } catch (e) {
        outcome = { state: 'failed', error: (e as Error).message };
        // No connection or an expired sign-in: stop here instead of failing every remaining row.
        if (e instanceof ApiError && (e.status === 0 || e.status === 401)) {
          setError(e.message);
          setOutcomes((o) => ({ ...o, [r.line]: outcome }));
          break;
        }
      }
      count++;
      setOutcomes((o) => ({ ...o, [r.line]: outcome }));
      setSent({ done: count, total: ready.length });
    }
    setRunning(false);
  }

  const fields = IMPORT_FIELDS[active];
  const columns = rows ? Math.max(0, ...rows.slice(0, 20).map((r) => r.length)) : 0;
  const header = rows && mapping ? (rows[mapping.skipRows - 1] ?? []) : [];
  const setColumn = (field: ImportField, value: string) => mapping && setMapping({ ...mapping, columns: { ...mapping.columns, [field]: value === '' ? null : Number(value) } });
  const label = (r: ImportRow) => r.values.name || r.values.sku || r.values.code || '';

  return (
    <section className="page">
      <h1>{tr('Import from a file')}</h1>
      <p className="muted">{tr('Save your sheet from Google Sheets or Excel as CSV or Excel (.xlsx), then upload it here. The file is read on this computer; each row is then added as if you typed it, so the usual checks apply.')}</p>
      <div className="form-card stack">
        <div className="form-row">
          <label>
            {tr('What to import')}
            <select value={active} disabled={running} onChange={(e) => { setKind(e.target.value as ImportKind); reset(); }}>
              {kinds.map((k) => <option key={k} value={k}>{tr(KIND_LABEL[k])}</option>)}
            </select>
          </label>
          <div><Button variant="outline" onClick={() => downloadTemplate(active)}>{tr('Download template')}</Button></div>
        </div>
        <input type="file" accept=".csv,.txt,.xlsx" disabled={running} onChange={(e) => void choose(e.target.files?.[0])} aria-label={tr('File to import')} />
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      {rows && mapping && (
        <div className="form-card stack">
          <strong>{fileName}</strong>
          <p className="muted small">{tr('Which column holds what? The guess is made from the header row. The rows above and including the header are skipped.')}</p>
          <div className="form-row three">
            {fields.map((d) => (
              <label key={d.field}>
                {tr(d.label)}
                <select value={mapping.columns[d.field] ?? ''} disabled={running} onChange={(e) => setColumn(d.field, e.target.value)}>
                  {!d.required && <option value="">{tr('Not in the file')}</option>}
                  {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{trf('Column {n}', { n: i + 1 })}{header[i] ? `: ${header[i]}` : ''}</option>)}
                </select>
              </label>
            ))}
            {active === 'items' && (
              <label>
                {tr('Warehouse for opening stock')}
                <select value={wh} disabled={running} onChange={(e) => setWarehouseId(e.target.value)}>
                  {warehouses.data.map((w) => <option key={w.id} value={w.id}>{w.code ? `${w.code} · ` : ''}{w.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {active === 'items' && <p className="muted small">{tr('Opening stock needs a unit cost once accounting is on. Rows without one are refused by the server and listed below.')}</p>}

          <p>{trf('{ready} rows ready, {bad} with problems, {done} already imported.', { ready: ready.length, bad: withProblems.length, done })}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr('Line')}</th>
                  {fields.map((d) => <th scope="col" key={d.field}>{tr(d.label)}</th>)}
                  <th scope="col">{tr('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {built.slice(0, PREVIEW_ROWS).map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    {fields.map((d) => <td key={d.field}><bdi>{r.values[d.field] ?? ''}</bdi></td>)}
                    <td>{r.problems.length ? <span className="error">{r.problems.map(problemText).join('; ')}</span> : outcomes[r.line]?.state === 'done' ? tr('Imported') : tr('Ready')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {built.length > PREVIEW_ROWS && <p className="muted small">{trf('Showing the first {n} rows.', { n: PREVIEW_ROWS })}</p>}
          {withProblems.length > 0 && (
            <details>
              <summary>{trf('Rows with problems ({n})', { n: withProblems.length })}</summary>
              <ul>{withProblems.slice(0, 100).map((r) => <li key={r.line}>{trf('Line {line}', { line: r.line })}: <bdi>{label(r)}</bdi> – {r.problems.map(problemText).join('; ')}</li>)}</ul>
            </details>
          )}
          <div className="form-row">
            <Button disabled={running || ready.length === 0} onClick={() => void send()}>
              {done > 0 || failed.length > 0 ? trf('Import the remaining {n} rows', { n: ready.length }) : trf('Import {n} rows', { n: ready.length })}
            </Button>
            {sent && <span role="status">{trf('{done} of {total} sent', sent)}</span>}
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div className="form-card stack">
          <strong>{trf('{n} rows were refused', { n: failed.length })}</strong>
          <p className="muted small">{tr('Fix them in your sheet or here, then press the import button again: only the rows not yet imported are sent.')}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{tr('Line')}</th><th scope="col">{tr('Name')}</th><th scope="col">{tr('Reason')}</th></tr></thead>
              <tbody>
                {failed.map((r) => (
                  <tr key={r.line}><td>{r.line}</td><td><bdi>{label(r)}</bdi></td><td className="error">{(outcomes[r.line] as { error: string }).error}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!running && done > 0 && ready.length === 0 && failed.length === 0 && <p role="status">{trf('{n} rows imported.', { n: done })}</p>}
    </section>
  );
}

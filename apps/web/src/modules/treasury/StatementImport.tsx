import { useState } from 'react';
import {
  fingerprints,
  hasPermission,
  readStatement,
  STATEMENT_DATE_FORMATS,
  type StatementDateFormat,
  type StatementLine,
  type StatementMapping,
  type StatementRowError,
  type TreasuryAccount,
} from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { guessMapping, readStatementFile, type StatementFile, StatementFileError } from '../../lib/statementFiles';
import { useLoad } from '../../lib/useLoad';
import { money } from '../accounting/common';

// ------------------------------------------------------------------ importing

export function ImportForm({ account, onDone }: { account: TreasuryAccount; onDone: (importId: string) => void }) {
  const [file, setFile] = useState<StatementFile | null>(null);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saved = useLoad(() => api<{ mapping: StatementMapping } | null>(`/v1/treasury/statements/accounts/${account.id}/format`));

  async function choose(f: File | undefined) {
    setError(null);
    setFile(null);
    if (!f) return;
    try {
      const read = await readStatementFile(f);
      setFile(read);
      if (read.kind === 'rows') setMapping(saved.data?.mapping ?? guessMapping(read.rows) ?? { date: 0, description: 1, amount: 2, dateFormat: 'dd/mm/yyyy', skipRows: 1 });
    } catch (e) {
      setError(e instanceof StatementFileError ? tr(e.message) : (e as Error).message);
    }
  }

  // The lines to import, and the rows that could not be read.
  let lines: StatementLine[] = [];
  let rowErrors: StatementRowError[] = [];
  let opening: number | null = null;
  let closing: number | null = null;
  if (file?.kind === 'rows' && mapping) {
    try {
      const r = readStatement(file.rows, mapping);
      lines = r.lines;
      rowErrors = r.errors;
    } catch {
      rowErrors = [];
    }
  } else if (file?.kind === 'mt940') {
    lines = file.statements.flatMap((s) => s.lines);
    opening = file.statements[0]?.openingMinor ?? null;
    closing = file.statements[file.statements.length - 1]?.closingMinor ?? null;
  }
  const withBalance = lines.filter((l) => l.balanceMinor !== null);
  if (closing === null && withBalance.length) {
    const latest = [...withBalance].sort((a, b) => b.bookingDate.localeCompare(a.bookingDate) || b.row - a.row)[0];
    closing = latest?.balanceMinor ?? null;
  }

  async function submit() {
    if (!file || lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      if (file.kind === 'rows' && mapping) await api(`/v1/treasury/statements/accounts/${account.id}/format`, { method: 'PUT', body: JSON.stringify({ mapping }) });
      const fps = fingerprints(account.id, lines);
      const res = await api<{ id: string }>(`/v1/treasury/statements/accounts/${account.id}/imports`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          fileHash: file.hash,
          format: file.format,
          openingMinor: opening,
          closingMinor: closing,
          lines: lines.map((l, i) => ({ ...l, fingerprint: fps[i] })),
        }),
      });
      onDone(res.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns = file?.kind === 'rows' ? Math.max(0, ...file.rows.slice(0, 20).map((r) => r.length)) : 0;
  const colSelect = (key: keyof StatementMapping, label: string, optional = true) =>
    mapping && (
      <label>
        {label}
        <select value={mapping[key] === undefined || mapping[key] === null ? '' : String(mapping[key])}
          onChange={(e) => setMapping({ ...mapping, [key]: e.target.value === '' ? null : Number(e.target.value) })}>
          {optional && <option value="">{tr('Not in the file')}</option>}
          {Array.from({ length: columns }, (_, i) => <option key={i} value={i}>{trf('Column {n}', { n: i + 1 })}{file?.kind === 'rows' && mapping.skipRows > 0 && file.rows[mapping.skipRows - 1]?.[i] ? `: ${file.rows[mapping.skipRows - 1]?.[i]}` : ''}</option>)}
        </select>
      </label>
    );

  return (
    <div className="form-card stack">
      <strong>{tr('Import a statement')}</strong>
      <p className="muted small">{tr('CSV, Excel (.xlsx), Word (.docx) or MT940. The file is read on this computer; only its lines are saved. PDF is not read yet.')}</p>
      <input type="file" accept=".csv,.txt,.xlsx,.docx,.sta,.mt940,.940" onChange={(e) => choose(e.target.files?.[0])} aria-label={tr('Statement file')} />
      {file?.kind === 'rows' && mapping && (
        <>
          <p className="muted small">{tr('Which column holds what? The guess is made from the header row; it is saved for this account.')}</p>
          <div className="form-row three">
            {colSelect('date', tr('Date'), false)}
            {colSelect('description', tr('Description'), false)}
            {colSelect('reference', tr('Reference'))}
          </div>
          <div className="form-row three">
            {colSelect('moneyIn', tr('Money in'))}
            {colSelect('moneyOut', tr('Money out'))}
            {colSelect('amount', tr('Amount (one column, minus = out)'))}
          </div>
          <div className="form-row three">
            {colSelect('balance', tr('Balance'))}
            <label>
              {tr('Date format')}
              <select value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as StatementDateFormat })}>
                {STATEMENT_DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label>
              {tr('Rows to skip at the top')}
              <input type="number" min={0} value={mapping.skipRows} onChange={(e) => setMapping({ ...mapping, skipRows: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
          </div>
        </>
      )}
      {file && (
        <>
          <p className="notice">
            {trf('{n} line(s) ready to import', { n: lines.length })}
            {rowErrors.length > 0 ? ` · ${trf('{n} row(s) could not be read and will not be imported', { n: rowErrors.length })}` : ''}
            {file.kind === 'mt940' && file.errors.length > 0 ? ` · ${trf('{n} statement(s) in the file do not add up and will not be imported', { n: file.errors.length })}` : ''}
          </p>
          {lines.length > 0 && (
            <div className="table-wrap"><table>
              <thead><tr><th scope="col">{tr('Date')}</th><th scope="col">{tr('Description')}</th><th scope="col">{tr('Reference')}</th><th scope="col" className="right">{tr('Amount')}</th></tr></thead>
              <tbody>
                {lines.slice(0, 8).map((l) => (
                  <tr key={l.row}><td className="nowrap">{l.bookingDate}</td><td>{l.description}</td><td>{l.reference}</td><td className={`right ${l.amountMinor < 0 ? 'overdue' : ''}`}>{money(l.amountMinor, account.currency)}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
          {rowErrors.length > 0 && (
            <p className="muted small">{tr('Rows not read')}: {rowErrors.slice(0, 12).map((e) => `${e.row} (${tr(e.reason === 'date' ? 'date' : e.reason === 'zero' ? 'no amount' : e.reason === 'both_in_and_out' ? 'money in and out' : e.reason === 'columns' ? 'too few columns' : 'amount')})`).join(', ')}{rowErrors.length > 12 ? '…' : ''}</p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <Button type="button" disabled={busy || lines.length === 0} onClick={submit}>{busy ? tr('Importing…') : tr('Import')}</Button>
      </div>
    </div>
  );
}

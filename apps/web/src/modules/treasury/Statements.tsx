import { useEffect, useState } from 'react';
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
import { ConfirmButton } from '../../components/FormToggle';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { Link, navigate, useParam } from '../../lib/router';
import { guessMapping, readStatementFile, type StatementFile, StatementFileError } from '../../lib/statementFiles';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';
import { money } from '../accounting/common';

// Bank statements (documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md; database sql/067). The file is read here, in the browser, and
// only its lines are sent. Matches are suggested and a person confirms each (or all exact ones at once); nothing moves money.

type ImportRow = {
  id: string;
  accountId: string;
  fileName: string;
  format: string;
  periodFrom: string;
  periodTo: string;
  closingMinor: number | null;
  added: number;
  skipped: number;
  importedAt: string;
  counts: { open: number; matched: number; ignored: number };
};
type Entry = { id: string; date: string; amountMinor: number; documentNumbers: string[]; memo: string; entryNumber: string };
type Suggestion = { tier: 'exact' | 'strong' | 'possible' | 'group'; candidateIds: string[]; days: number; entries: Entry[] };
type Line = {
  id: string;
  lineNo: number;
  bookingDate: string;
  description: string;
  reference: string;
  amountMinor: number;
  balanceMinor: number | null;
  status: 'open' | 'matched' | 'ignored';
  ignoreReason: string | null;
  /** A rule (sql/068) whose text this line contains: record it as an expense in that category. */
  rule: { ruleId: string; categoryId: string; contains: string } | null;
  matches: { entryLineId: string; amountMinor: number }[];
  suggestions: Suggestion[];
};
type ImportDetail = { id: string; accountId: string; fileName: string; periodFrom: string; periodTo: string; closingMinor: number | null; lines: Line[] };
type Reconciliation = {
  id: string;
  toDate: string;
  bankClosingMinor: number;
  ledgerBalanceMinor: number;
  unmatchedLedgerMinor: number;
  ignoredBankMinor: number;
  status: 'closed' | 'reopened';
  closedAt: string;
  reopenReason: string | null;
};

const TIER_LABEL: Record<Suggestion['tier'], string> = { exact: 'Exact match', strong: 'Likely match', possible: 'Possible match', group: 'Several entries' };
const STATUS_LABEL: Record<Line['status'], string> = { open: 'Open', matched: 'Matched', ignored: 'Ignored' };
const STATUS_PILL: Record<Line['status'], string> = { open: 'submitted', matched: 'received', ignored: 'cancelled' };

// ------------------------------------------------------------------ the list page

export function BankStatementsPage() {
  const session = useSession();
  const can = (key: string) => hasPermission(session.permissions, key);
  const accounts = useLoad(() => api<TreasuryAccount[]>('/v1/treasury/accounts'));
  const imports = useLoad(() => api<ImportRow[]>('/v1/treasury/statements/imports'));
  const banks = (accounts.data ?? []).filter((a) => a.kind === 'bank' && a.active);
  const [accountId, setAccountId] = useState('');
  useEffect(() => {
    if (!accountId && banks[0]) setAccountId(banks[0].id);
  }, [banks, accountId]);
  const account = banks.find((a) => a.id === accountId);

  if (accounts.error) return <section className="page"><p className="error">{accounts.error}</p></section>;
  if (!accounts.data || !imports.data) return <section className="page"><Loading /></section>;

  return (
    <section className="page wide">
      <h1>{tr('Bank statements')}</h1>
      <p className="muted">{tr('Import a statement from your bank, match each line to your books, and close the month when everything agrees.')}</p>
      {banks.length === 0 ? (
        <p className="notice">{tr('Add a bank account in Cash and banks first.')}</p>
      ) : (
        <label className="narrow">
          {tr('Bank account')}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name} ({b.currency})</option>)}
          </select>
        </label>
      )}
      {account && can('treasury.statements.import') && <ImportForm account={account} onDone={(id) => navigate(`/treasury/statements/${id}`)} />}
      <h2 className="related">{tr('Imported statements')}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('File')}</th><th scope="col">{tr('Period')}</th><th scope="col" className="right">{tr('Open')}</th><th scope="col" className="right">{tr('Matched')}</th><th scope="col" className="right">{tr('Ignored')}</th><th scope="col">{tr('Imported')}</th></tr></thead>
          <tbody>
            {imports.data.filter((i) => !accountId || i.accountId === accountId).map((i) => (
              <tr key={i.id}>
                <td><Link to={`/treasury/statements/${i.id}`}>{i.fileName}</Link></td>
                <td className="nowrap">{formatDay(i.periodFrom, session.org)} – {formatDay(i.periodTo, session.org)}</td>
                <td className="right">{i.counts.open ? <strong>{i.counts.open}</strong> : 0}</td>
                <td className="right">{i.counts.matched}</td>
                <td className="right">{i.counts.ignored}</td>
                <td className="nowrap">{formatDateTime(i.importedAt, session.org)}</td>
              </tr>
            ))}
            {imports.data.filter((i) => !accountId || i.accountId === accountId).length === 0 && <tr><td colSpan={6} className="muted">{tr('No statements imported for this account yet.')}</td></tr>}
          </tbody>
        </table>
      </div>
      {account && <Periods account={account} lastClosing={imports.data.find((i) => i.accountId === account.id && i.closingMinor !== null)} />}
      {banks.length > 0 && <Rules banks={banks} canEdit={can('treasury.statements.reconcile')} />}
      <ReconcileRoles isOwner={session.role === 'owner'} />
    </section>
  );
}

// ------------------------------------------------------------------ rules and who may reconcile (sql/068)

type Rule = { id: string; accountId: string | null; contains: string; categoryId: string; note: string | null };
const BANK_CHARGES = '__bank_charges';

/** "When the bank text contains X, it is an expense in category Y": offered as a one-click suggestion on money-out lines. */
function Rules({ banks, canEdit }: { banks: TreasuryAccount[]; canEdit: boolean }) {
  const rules = useLoad(() => api<Rule[]>('/v1/treasury/statements/rules'));
  const categories = useLoad(() => api<Category[]>('/v1/finance/categories').catch(() => [] as Category[]));
  const [contains, setContains] = useState('');
  const [categoryId, setCategoryId] = useState(BANK_CHARGES);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catName = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '…';
  const bankName = (id: string | null) => (id ? (banks.find((b) => b.id === id)?.name ?? '…') : tr('Every bank account'));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      rules.reload();
      categories.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = () => act(async () => {
    const cat = categoryId === BANK_CHARGES
      ? (await api<{ categoryId: string }>('/v1/treasury/statements/bank-charges/prepare', { method: 'POST' })).categoryId
      : categoryId;
    await api('/v1/treasury/statements/rules', { method: 'POST', body: JSON.stringify({ contains: contains.trim(), categoryId: cat, accountId: accountId || undefined }) });
    setContains('');
  });

  return (
    <>
      <h2 className="related">{tr('Rules')}</h2>
      <p className="muted small">{tr('When a money-out line contains this text, offer to record it as an expense in this category with one click. Nothing is recorded without a click.')}</p>
      {rules.error && <p className="error">{rules.error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('The text contains')}</th><th scope="col">{tr('Expense category')}</th><th scope="col">{tr('Bank account')}</th>{canEdit && <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>}</tr></thead>
          <tbody>
            {(rules.data ?? []).map((r) => (
              <tr key={r.id}>
                <td><bdi>{r.contains}</bdi></td>
                <td>{catName(r.categoryId)}</td>
                <td>{bankName(r.accountId)}</td>
                {canEdit && <td className="right"><ConfirmButton size="sm" label={tr('Delete')} confirmLabel={tr('Delete')} question={tr('Delete this rule?')} disabled={busy} onConfirm={() => act(() => api(`/v1/treasury/statements/rules/${r.id}`, { method: 'DELETE' }))} /></td>}
              </tr>
            ))}
            {rules.data && rules.data.length === 0 && <tr><td colSpan={canEdit ? 4 : 3} className="muted">{tr('No rules yet.')}</td></tr>}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="form-card form-row">
          <label>{tr('The text contains')}<input value={contains} maxLength={100} onChange={(e) => setContains(e.target.value)} placeholder={tr('for example: COMMISSION')} /></label>
          <label>
            {tr('Expense category')}
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value={BANK_CHARGES}>{tr('Bank charges (created if missing)')}</option>
              {(categories.data ?? []).filter((c) => c.name.toLowerCase() !== 'bank charges').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>
            {tr('Bank account')}
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{tr('Every bank account')}</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
            </select>
          </label>
          <Button disabled={busy || contains.trim().length < 2} onClick={add}>{tr('Add rule')}</Button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

const ROLE_CHOICES = ['owner', 'admin', 'head_accountant'] as const;

/** Who may match, ignore and close statements (default: owner and head accountant). Only the owner changes it; the owner always stays. */
function ReconcileRoles({ isOwner }: { isOwner: boolean }) {
  const saved = useLoad(() => api<{ roles: string[] }>('/v1/treasury/statements/reconcile-roles'));
  const [roles, setRoles] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const current = roles ?? saved.data?.roles ?? [];
  const label: Record<string, string> = { owner: 'Owner', admin: 'Admin', head_accountant: 'Head accountant' };
  if (saved.error) return null; // not set up yet, or no access: nothing to show

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/v1/treasury/statements/reconcile-roles', { method: 'PUT', body: JSON.stringify({ roles: current }) });
      saved.reload();
      setRoles(null);
      setMsg({ ok: true, text: tr('Saved.') });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="related">{tr('Who may reconcile')}</h2>
      <p className="muted small">{tr('These roles may match, ignore and close bank statements. Others can only look.')}</p>
      <fieldset className="form-row" disabled={!isOwner || busy}>
        <legend className="sr-only">{tr('Who may reconcile')}</legend>
        {ROLE_CHOICES.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="checkbox" checked={r === 'owner' || current.includes(r)} disabled={r === 'owner'}
              onChange={(e) => setRoles(e.target.checked ? [...current.filter((x) => x !== r), r] : current.filter((x) => x !== r))} />
            {tr(label[r] ?? r)}
          </label>
        ))}
        {isOwner && <Button size="sm" disabled={busy || roles === null} onClick={save}>{tr('Save')}</Button>}
      </fieldset>
      {!isOwner && <p className="muted small">{tr('Only the owner can change this.')}</p>}
      {msg && <p className={msg.ok ? 'success' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
    </>
  );
}

// ------------------------------------------------------------------ importing

function ImportForm({ account, onDone }: { account: TreasuryAccount; onDone: (importId: string) => void }) {
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

// ------------------------------------------------------------------ closing a period

function Periods({ account, lastClosing }: { account: TreasuryAccount; lastClosing: ImportRow | undefined }) {
  const session = useSession();
  const canReconcile = hasPermission(session.permissions, 'treasury.statements.reconcile');
  const recs = useLoad(() => api<Reconciliation[]>(`/v1/treasury/statements/accounts/${account.id}/reconciliations`));
  const [toDate, setToDate] = useState(lastClosing?.periodTo ?? '');
  const [closing, setClosing] = useState(lastClosing?.closingMinor !== null && lastClosing?.closingMinor !== undefined ? (lastClosing.closingMinor / 100).toFixed(2) : '');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const latest = recs.data?.find((r) => r.status === 'closed');

  async function close() {
    setMsg(null);
    try {
      await api(`/v1/treasury/statements/accounts/${account.id}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ toDate, bankClosingMinor: Math.round(Number(closing.replace(/,/g, '')) * 100) }),
      });
      setMsg({ ok: true, text: tr('Reconciled and closed. Lines up to that date can no longer be changed.') });
      recs.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  async function reopen(id: string) {
    setMsg(null);
    try {
      await api(`/v1/treasury/statements/reconciliations/${id}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) });
      setReason('');
      recs.reload();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  return (
    <>
      <h2 className="related">{tr('Reconciled periods')}</h2>
      {canReconcile && (
        <div className="form-card stack">
          <p className="muted small">{tr('Close a period when every bank line up to that date is matched or ignored, and the bank balance agrees with the books.')}</p>
          <div className="form-row">
            <label>{tr('Up to')}<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
            <label>{trf('Bank balance on that date ({currency})', { currency: account.currency })}<input inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} /></label>
          </div>
          <div className="form-actions"><Button type="button" disabled={!toDate || closing.trim() === ''} onClick={close}>{tr('Reconcile and close')}</Button></div>
        </div>
      )}
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{tr('Up to')}</th><th scope="col" className="right">{tr('Bank')}</th><th scope="col" className="right">{tr('Books')}</th><th scope="col" className="right">{tr('In the books, not yet at the bank')}</th><th scope="col">{tr('Status')}</th></tr></thead>
        <tbody>
          {(recs.data ?? []).map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{formatDay(r.toDate, session.org)}</td>
              <td className="right">{money(r.bankClosingMinor, account.currency)}</td>
              <td className="right">{money(r.ledgerBalanceMinor, account.currency)}</td>
              <td className="right">{money(r.unmatchedLedgerMinor, account.currency)}</td>
              <td>{r.status === 'closed' ? <Pill status="received" label={tr('Closed')} /> : <span className="muted">{tr('Reopened')}: {r.reopenReason}</span>}</td>
            </tr>
          ))}
          {(recs.data ?? []).length === 0 && <tr><td colSpan={5} className="muted">{tr('No period reconciled yet.')}</td></tr>}
        </tbody>
      </table></div>
      {canReconcile && latest && (
        <div className="form-row">
          <label>{tr('Reason to reopen the latest period')}<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <ConfirmButton label={tr('Reopen')} confirmLabel={tr('Yes, reopen')} disabled={!reason.trim()} question={tr('Reopen the latest reconciled period? Its lines can be changed again.')} onConfirm={() => reopen(latest.id)} />
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ one statement: matching

// ------------------------------------------------------------------ explaining a line (sql/068)

type OpenItem = { id: string; kind: 'customer_invoice' | 'supplier_invoice' | 'expense'; number: string; currency: string; leftMinor: number; dueDate: string };
type Category = { id: string; name: string };
type ExplainKind = 'expense' | 'customer_payment' | 'supplier_payment' | 'transfer';

/** Record what an unmatched bank line was: money out as an expense, a supplier payment or a transfer; money in as a customer payment
 *  or a transfer. Saved through the usual functions (with their checks), dated on the bank line, for its amount, and matched. */
function ExplainForm({ line, accountId, currency, busy, onCancel, onSubmit }: {
  line: Line;
  accountId: string;
  currency: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, string>) => void;
}) {
  const out = line.amountMinor < 0;
  const kinds: ExplainKind[] = out ? ['expense', 'supplier_payment', 'transfer'] : ['customer_payment', 'transfer'];
  const [kind, setKind] = useState<ExplainKind>(kinds[0] ?? 'transfer');
  const [choice, setChoice] = useState('');
  const [note, setNote] = useState('');
  const categories = useLoad(() => (out ? api<Category[]>('/v1/finance/categories') : Promise.resolve([] as Category[])));
  const items = useLoad(() => api<OpenItem[]>(`/v1/finance/open-items?direction=${out ? 'out' : 'in'}`).catch(() => [] as OpenItem[]));
  const accounts = useLoad(() => api<TreasuryAccount[]>('/v1/treasury/accounts'));
  const amount = Math.abs(line.amountMinor);
  // Open invoices or bills in this currency, closest amount first: the right one is usually at the top.
  const open = (items.data ?? [])
    .filter((i) => i.kind === (kind === 'customer_payment' ? 'customer_invoice' : 'supplier_invoice') && i.currency === currency)
    .sort((a, b) => Math.abs(a.leftMinor - amount) - Math.abs(b.leftMinor - amount))
    .slice(0, 30);
  const others = (accounts.data ?? []).filter((a) => a.id !== accountId && a.active && a.currency === currency);
  const KIND_LABEL: Record<ExplainKind, string> = {
    expense: 'An expense paid from the bank',
    supplier_payment: 'A payment to a supplier',
    customer_payment: 'A payment from a customer',
    transfer: out ? 'A transfer to another of our accounts' : 'A transfer from another of our accounts',
  };
  const ready = kind === 'expense' || choice !== '';
  const body = (): Record<string, string> => {
    const b: Record<string, string> = { kind, note };
    if (kind === 'expense' && choice) b.categoryId = choice;
    if (kind === 'customer_payment') b.invoiceId = choice;
    if (kind === 'supplier_payment') b.billId = choice;
    if (kind === 'transfer') b.otherAccountId = choice;
    return b;
  };

  return (
    <div className="form-card stack">
      <label>
        {tr('What was it?')}
        <select value={kind} onChange={(e) => { setKind(e.target.value as ExplainKind); setChoice(''); }}>
          {kinds.map((k) => <option key={k} value={k}>{tr(KIND_LABEL[k])}</option>)}
        </select>
      </label>
      {kind === 'expense' && (
        <label>
          {tr('Expense category')}
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{tr('Bank charges (created if missing)')}</option>
            {(categories.data ?? []).filter((c) => c.name.toLowerCase() !== 'bank charges').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {(kind === 'customer_payment' || kind === 'supplier_payment') && (
        <label>
          {kind === 'customer_payment' ? tr('Which invoice?') : tr('Which supplier bill?')}
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{tr('Choose…')}</option>
            {open.map((i) => <option key={i.id} value={i.id}>{i.number} · {trf('{amount} still due', { amount: money(i.leftMinor, i.currency) })}</option>)}
          </select>
        </label>
      )}
      {(kind === 'customer_payment' || kind === 'supplier_payment') && items.data && open.length === 0 && <p className="muted small">{tr('Nothing open in this currency.')}</p>}
      {kind === 'transfer' && (
        <label>
          {tr('The other account')}
          <select value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{tr('Choose…')}</option>
            {others.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select>
        </label>
      )}
      <label>{tr('Note (optional)')}<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={line.description} /></label>
      <p className="muted small">{trf('Recorded on {date} for {amount}, through this bank account, then matched to this line.', { date: line.bookingDate, amount: money(amount, currency) })}</p>
      <div className="form-actions">
        <Button size="sm" disabled={busy || !ready} onClick={() => onSubmit(body())}>{tr('Record and match')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{tr('Cancel')}</Button>
      </div>
    </div>
  );
}

export function BankStatementPage() {
  const id = useParam('id');
  const session = useSession();
  const canReconcile = hasPermission(session.permissions, 'treasury.statements.reconcile');
  const detail = useLoad(() => api<ImportDetail>(`/v1/treasury/statements/imports/${id}`));
  const accounts = useLoad(() => api<TreasuryAccount[]>('/v1/treasury/accounts'));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      detail.reload();
    }
  }

  if (detail.error) return <section className="page"><p className="error">{detail.error}</p></section>;
  if (!detail.data || !accounts.data) return <section className="page"><Loading /></section>;
  const d = detail.data;
  const currency = accounts.data.find((a) => a.id === d.accountId)?.currency ?? session.org?.defaultCurrency ?? 'EGP';
  const exactCount = d.lines.filter((l) => l.status === 'open' && l.suggestions.filter((s) => s.tier === 'exact').length === 1).length;
  const counts = { open: 0, matched: 0, ignored: 0 };
  for (const l of d.lines) counts[l.status]++;
  const shown = onlyOpen ? d.lines.filter((l) => l.status === 'open') : d.lines;

  return (
    <section className="page wide">
      <Link to="/treasury/statements" className="back-link">{tr('← Bank statements')}</Link>
      <h1>{d.fileName}</h1>
      <dl className="facts">
        <div><dt>{tr('Period')}</dt><dd>{formatDay(d.periodFrom, session.org)} – {formatDay(d.periodTo, session.org)}</dd></div>
        <div><dt>{tr('Open')}</dt><dd>{counts.open}</dd></div>
        <div><dt>{tr('Matched')}</dt><dd>{counts.matched}</dd></div>
        <div><dt>{tr('Ignored')}</dt><dd>{counts.ignored}</dd></div>
      </dl>
      {canReconcile && exactCount > 0 && (
        <ConfirmButton
          label={trf('Confirm all {n} exact matches', { n: exactCount })}
          confirmLabel={tr('Yes, confirm them')}
          disabled={busy}
          question={trf('Confirm {n} matches where the amount is the same and our document number is in the bank text? Each is recorded in the history and can be undone while the period is open.', { n: exactCount })}
          onConfirm={() => run(async () => {
            const r = await api<{ confirmed: number; refused: unknown[] }>(`/v1/treasury/statements/imports/${d.id}/confirm-exact`, { method: 'POST' });
            return trf('{n} matched.', { n: r.confirmed }) + (r.refused.length ? ` ${trf('{n} could not be matched.', { n: r.refused.length })}` : '');
          })}
        />
      )}
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}
      <label className="inline-check"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {tr('Show only open lines')}</label>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('Date')}</th><th scope="col">{tr('Bank text')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col">{tr('Status')}</th><th scope="col">{tr('In the books')}</th></tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{formatDay(l.bookingDate, session.org)}</td>
                <td>{l.description}{l.reference ? <div className="muted small">{l.reference}</div> : null}</td>
                <td className={`right ${l.amountMinor < 0 ? 'overdue' : ''}`}>{money(l.amountMinor, currency)}</td>
                <td><Pill status={STATUS_PILL[l.status]} label={tr(STATUS_LABEL[l.status])} />{l.ignoreReason ? <div className="muted small">{l.ignoreReason}</div> : null}</td>
                <td>
                  {l.status === 'open' && l.suggestions.length === 0 && !l.rule && <span className="muted">{tr('Nothing in the books matches. Record what it was, or ignore it with a reason.')}</span>}
                  {l.status === 'open' && l.rule && canReconcile && (
                    <div className="stack" style={{ marginBlockEnd: '0.4rem' }}>
                      <span className="small"><strong>{tr('Rule')}</strong>: {trf('the text contains "{text}"', { text: l.rule.contains })}</span>
                      <Button size="sm" disabled={busy} onClick={() => run(async () => {
                        await api(`/v1/treasury/statements/lines/${l.id}/explain`, { method: 'POST', body: JSON.stringify({ kind: 'expense', categoryId: l.rule?.categoryId }) });
                        return tr('Recorded as an expense paid from the bank, and matched.');
                      })}>{tr('Record as the rule says')}</Button>
                    </div>
                  )}
                  {l.status === 'open' && canReconcile && (explaining === l.id
                    ? <ExplainForm line={l} accountId={d.accountId} currency={currency} busy={busy} onCancel={() => setExplaining(null)}
                        onSubmit={(body) => run(async () => {
                          await api(`/v1/treasury/statements/lines/${l.id}/explain`, { method: 'POST', body: JSON.stringify(body) });
                          setExplaining(null);
                          return tr('Recorded and matched.');
                        })} />
                    : <Button size="sm" variant="outline" onClick={() => setExplaining(l.id)}>{tr('Record what it was…')}</Button>)}
                  {l.status === 'open' && l.suggestions.slice(0, 3).map((s) => (
                    <div key={s.candidateIds.join('+')} className="stack" style={{ marginBlockEnd: '0.4rem' }}>
                      <span className="small"><strong>{tr(TIER_LABEL[s.tier])}</strong>: {s.entries.map((e) => `${e.entryNumber} ${formatDay(e.date, session.org)} ${e.memo}`).join(' + ')}</span>
                      {canReconcile && <Button size="sm" variant={s.tier === 'exact' ? 'default' : 'outline'} disabled={busy}
                        onClick={() => run(async () => {
                          await api(`/v1/treasury/statements/lines/${l.id}/match`, { method: 'POST', body: JSON.stringify({ entryLineIds: s.candidateIds }) });
                          return tr('Matched.');
                        })}>{tr('Confirm')}</Button>}
                    </div>
                  ))}
                  {l.status === 'open' && canReconcile && (ignoring === l.id ? (
                    <div className="form-row">
                      <label>{tr('Why ignore it?')}<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
                      <Button size="sm" variant="outline" disabled={busy || !reason.trim()} onClick={() => run(async () => {
                        await api(`/v1/treasury/statements/lines/${l.id}/ignore`, { method: 'POST', body: JSON.stringify({ reason }) });
                        setIgnoring(null);
                        setReason('');
                        return tr('Ignored.');
                      })}>{tr('Ignore')}</Button>
                    </div>
                  ) : <Button size="sm" variant="ghost" onClick={() => { setIgnoring(l.id); setReason(''); }}>{tr('Ignore…')}</Button>)}
                  {l.status !== 'open' && canReconcile && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => {
                      await api(`/v1/treasury/statements/lines/${l.id}/unmatch`, { method: 'POST' });
                      return tr('Back to open.');
                    })}>{tr('Undo')}</Button>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} className="muted">{onlyOpen ? tr('Every line is matched or ignored.') : tr('No lines.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

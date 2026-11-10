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
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';
import { money } from '../accounting/common';
import { type ImportRow, type ImportDetail, TIER_LABEL, STATUS_LABEL, STATUS_PILL } from './statementTypes';
import { type Rule, Rules, ReconcileRoles } from './StatementRules';
import { ImportForm } from './StatementImport';
import { Periods } from './StatementPeriods';
import { ExplainForm } from './StatementExplain';

// Bank statements (documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md; database sql/067). The file is read here, in the browser, and
// only its lines are sent. Matches are suggested and a person confirms each (or all exact ones at once); nothing moves money.

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

// ------------------------------------------------------------------ one statement: matching

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

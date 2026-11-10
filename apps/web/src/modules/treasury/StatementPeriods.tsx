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
import { ConfirmButton } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';
import { money } from '../accounting/common';
import type { ImportRow, Reconciliation } from './statementTypes';

// ------------------------------------------------------------------ closing a period

export function Periods({ account, lastClosing }: { account: TreasuryAccount; lastClosing: ImportRow | undefined }) {
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

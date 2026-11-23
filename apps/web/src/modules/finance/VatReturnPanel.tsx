import { DateInput } from '../../components/DateInput';
import { useState } from 'react';
import { formatMoney, hasPermission, type Account, type VatMonth } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { AccountSelect } from '../accounting/common';

// Closing a VAT month (sql/091, VAT plan part 4), under the VAT summary when a whole month is shown and accounting is on. The month's
// VAT comes from the books (output and input VAT accounts) beside the document summary; closing creates a manual journal (output VAT
// and input VAT cleared to the VAT settlement account) that someone else approves, or that the owner or head accountant posts at once.
// Payments to the tax authority are journals too. Everything can be reversed like any journal.

export function VatReturnPanel({ month }: { month: string }) {
  const session = useSession();
  const canPostDirect = hasPermission(session.permissions, 'accounting.journal.post_direct');
  const canCreate = hasPermission(session.permissions, 'accounting.journal.create');
  const m = useLoad(() => api<VatMonth>(`/v1/accounting/vat-months/${month.slice(0, 7)}`));
  const accounts = useLoad(() => (canCreate ? api<Account[]>('/v1/accounting/accounts') : Promise.resolve([] as Account[])));
  const [postNow, setPostNow] = useState(false);
  const [payFrom, setPayFrom] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payOn, setPayOn] = useState(() => todayIn());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (m.error) return <p className="muted small">{m.error}</p>;
  const v = m.data;
  if (!v) return null;
  const money = (x: number) => formatMoney({ amountMinor: x, currency: v.currency });
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
      m.reload();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const live = v.period && (v.period.journalStatus === 'draft' || v.period.journalStatus === 'posted') ? v.period : null;
  const leafAccounts = (accounts.data ?? []).filter((a) => a.active !== false);

  return (
    <div className="form-card stack">
      <h2>{tr('Close the VAT month')}</h2>
      <dl className="facts">
        <div><dt>{tr('Output VAT in the books')}</dt><dd className="amount">{money(v.ledgerOutputMinor)}</dd></div>
        <div><dt>{tr('Input VAT in the books')}</dt><dd className="amount">{money(v.ledgerInputMinor)}</dd></div>
        <div>
          <dt>{v.ledgerDueMinor >= 0 ? tr('VAT due (books)') : tr('VAT credit (books)')}</dt>
          <dd className="amount"><strong>{money(Math.abs(v.ledgerDueMinor))}</strong></dd>
        </div>
        <div><dt>{tr('Return due by')}</dt><dd>{formatDay(v.returnDueOn, session.org)}</dd></div>
      </dl>
      {v.differenceMinor !== null && v.differenceMinor !== 0 ? (
        <p className="error notice">
          {trf('The books differ from the documents by {amount}. Check manual journals and documents dated in this month before closing.', { amount: money(v.differenceMinor) })}
        </p>
      ) : null}
      {v.creditStreak > 0 ? (
        <p className="notice">
          {v.refundAvailable
            ? trf('{n} credit months in a row: a refund can be asked for (to confirm with your accountant).', { n: v.creditStreak })
            : trf('{n} credit month(s) in a row. A refund can be asked for after more than {limit}.', { n: v.creditStreak, limit: v.smallEnterprise ? 3 : 4 })}
        </p>
      ) : null}

      {live ? (
        <>
          <p>
            {live.journalStatus === 'draft'
              ? tr('This month\'s closing journal is waiting for approval (Accounting → Journals).')
              : live.dueMinor > 0
                ? trf('Closed. Paid {paid} of {due}; {left} left to pay.', { paid: money(live.paidMinor), due: money(live.dueMinor), left: money(live.leftMinor) })
                : trf('Closed with a credit of {amount} carried forward.', { amount: money(-live.dueMinor) })}
          </p>
          {canCreate && live.journalStatus === 'posted' && live.leftMinor > 0 ? (
            <div className="form-row">
              <AccountSelect accounts={leafAccounts} value={payFrom} onChange={setPayFrom} label={tr('Paid from (bank or cash account)')} />
              <label>
                {tr('Amount')}
                <input inputMode="decimal" value={payAmount} placeholder={String(live.leftMinor / 100)} onChange={(e) => setPayAmount(e.target.value)} />
              </label>
              <label>
                {tr('Paid on')}
                <DateInput value={payOn} onChange={(e) => setPayOn(e.target.value)} />
              </label>
              <Button
                disabled={busy || !payFrom}
                onClick={() =>
                  run(async () => {
                    const amountMinor = payAmount.trim() ? Math.round(Number(payAmount) * 100) : live.leftMinor;
                    await api(`/v1/accounting/vat-periods/${live.id}/payments`, {
                      method: 'POST',
                      body: JSON.stringify({ accountId: payFrom, amountMinor, paidOn: payOn, post: canPostDirect && postNow }),
                    });
                    setPayAmount('');
                    return canPostDirect && postNow ? tr('Payment recorded.') : tr('Payment journal saved for approval.');
                  })
                }
              >
                {tr('Record the payment')}
              </Button>
            </div>
          ) : null}
        </>
      ) : canCreate ? (
        <div className="form-row">
          {canPostDirect ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={postNow} onChange={(e) => setPostNow(e.target.checked)} />
              {tr('Post now (no approval)')}
            </label>
          ) : null}
          <Button
            disabled={busy || !v.ended || (v.ledgerOutputMinor === 0 && v.ledgerInputMinor === 0)}
            onClick={() =>
              run(async () => {
                await api(`/v1/accounting/vat-months/${month.slice(0, 7)}/close`, { method: 'POST', body: JSON.stringify({ post: canPostDirect && postNow }) });
                return canPostDirect && postNow ? tr('Month closed.') : tr('Closing journal saved for approval.');
              })
            }
          >
            {tr('Close this VAT month')}
          </Button>
          {!v.ended ? <span className="muted small">{tr('A month can be closed after it has ended.')}</span> : null}
        </div>
      ) : null}
      {message ? <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p> : null}
    </div>
  );
}

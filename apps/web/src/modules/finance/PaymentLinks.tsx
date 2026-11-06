import { formatMoney, hasPermission, type ProviderSettings } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { ConfirmButton } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import { formatDateTime } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Notice, useNotice } from '../accounting/common';

// "Pay now" links on a sales invoice (sql/057; Paymob and Fawry). The customer pays on the provider's page or at a Fawry outlet; the
// provider's signed callback then records the payment here. Nothing is recorded by this screen except a simulated test payment.

type Link = {
  id: string;
  provider: 'paymob' | 'fawry';
  amount_minor: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'review';
  simulated: boolean;
  url: string | null;
  provider_txn: string | null;
  review_reason: string | null;
  created_at: string;
  paid_at: string | null;
};

const NAME = { paymob: 'Paymob', fawry: 'Fawry' } as const;
const STATUS: Record<Link['status'], string> = {
  pending: 'Waiting for payment',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
  review: 'Needs a person to check',
};

export function PaymentLinks({ invoiceId, onPaid }: { invoiceId: string; onPaid: () => void }) {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const allowed = !demoMode && hasPermission(session.permissions, 'finance.entries.manage') && hasPermission(session.permissions, 'core.integrations.view');
  const providers = useLoad(() => (allowed ? api<ProviderSettings[]>('/v1/core/integrations/providers') : Promise.resolve([] as ProviderSettings[])));
  const links = useLoad(() => (allowed ? api<Link[]>(`/v1/finance/payment-links?invoiceId=${invoiceId}`) : Promise.resolve([] as Link[])));
  if (!allowed) return null;
  if (!providers.data || !links.data) return <Loading error={providers.error ?? links.error} rows={2} />;
  const on = providers.data.filter((p) => (p.kind === 'paymob' || p.kind === 'fawry') && p.enabled);
  if (!on.length && !links.data.length) return null;
  const reload = () => {
    links.reload();
    onPaid();
  };

  return (
    <>
      <h2 className="related">{tr('Pay now links')}</h2>
      <Notice message={message} />
      {on.length ? (
        <div className="form-row">
          {on.map((p) => (
            <Button
              key={p.kind}
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api('/v1/finance/payment-links', { method: 'POST', body: JSON.stringify({ invoiceId, provider: p.kind }) });
                  return p.mode === 'simulated' ? tr('Test link created. Use "Simulate payment" to try it.') : tr('Link created.');
                }, reload)
              }
            >
              {trf('Create {provider} link', { provider: NAME[p.kind as 'paymob' | 'fawry'] })}
            </Button>
          ))}
        </div>
      ) : null}
      {links.data.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('Provider')}</th>
                <th scope="col" className="right">{tr('Amount')}</th>
                <th scope="col">{tr('Status')}</th>
                <th scope="col">{tr('Pay at')}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {links.data.map((l) => (
                <tr key={l.id}>
                  <td>
                    {NAME[l.provider]}
                    {l.simulated ? <span className="muted small"> · {tr('Simulated')}</span> : null}
                  </td>
                  <td className="right">{formatMoney({ amountMinor: l.amount_minor, currency: l.currency })}</td>
                  <td>
                    {tr(STATUS[l.status])}
                    {l.status === 'review' && l.review_reason ? <span className="error small"> · {l.review_reason}</span> : null}
                    {l.paid_at ? <span className="muted small"> · {formatDateTime(l.paid_at, session.org)}</span> : null}
                  </td>
                  <td>
                    {l.status !== 'pending' ? null : l.url ? (
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {tr('Open pay page')}
                      </a>
                    ) : l.provider_txn ? (
                      trf('Fawry reference {ref}', { ref: l.provider_txn })
                    ) : l.simulated ? (
                      <span className="muted small">{tr('No real page in test mode')}</span>
                    ) : null}
                  </td>
                  <td>
                    {l.status === 'pending' ? (
                      <div className="form-row">
                        {l.simulated ? (
                          <ConfirmButton
                            label={tr('Simulate payment')}
                            confirmLabel={tr('Yes, record a test payment')}
                            question={tr('This records a real payment in your books marked as simulated. Use it only to try the flow.')}
                            disabled={busy}
                            onConfirm={() => run(async () => { await api(`/v1/finance/payment-links/${l.id}/simulate-pay`, { method: 'POST' }); return tr('Test payment recorded.'); }, reload)}
                          />
                        ) : null}
                        <ConfirmButton
                          label={tr('Cancel link')}
                          confirmLabel={tr('Yes, cancel')}
                          question={tr('Cancel this link? A payment made on it afterwards will not be recorded automatically.')}
                          disabled={busy}
                          onConfirm={() => run(async () => { await api(`/v1/finance/payment-links/${l.id}/cancel`, { method: 'POST' }); return tr('Cancelled.'); }, reload)}
                        />
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

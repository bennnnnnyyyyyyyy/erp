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
// provider's signed callback then records the payment here; this screen never records a payment itself. sql/082: there is no test
// mode; a link made with the provider's test keys is a real test link at the provider. Old links marked "Simulated" are history only.

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
                  return tr('Link created.');
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
                <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>
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
                    ) : null}
                  </td>
                  <td>
                    {l.status === 'pending' ? (
                      <div className="form-row">
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

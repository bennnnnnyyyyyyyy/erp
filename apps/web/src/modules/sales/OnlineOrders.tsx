import { formatMoney, hasPermission, type ProviderSettings } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { Link } from '../../lib/router';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { tr } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Notice, useNotice } from '../accounting/common';

// Sales > Online orders (sql/059): what arrived from the store, what is held for a person, and a simulated test order. An order that
// arrives becomes an open sales order; stock still needs the normal approved request. Shopify itself is connected in Settings > Integrations.

type Online = {
  id: string;
  shopify_order_id: string;
  shopify_name: string | null;
  status: 'imported' | 'review';
  review_reason: string | null;
  sales_order_id: string | null;
  simulated: boolean;
  total_minor: number | null;
  currency: string | null;
  created_at: string;
};

export function OnlineOrders() {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const canManage = hasPermission(session.permissions, 'core.integrations.manage');
  const list = useLoad(() => api<Online[]>('/v1/sales/online-orders'));
  const providers = useLoad(() => api<ProviderSettings[]>('/v1/core/integrations/providers'));
  if (!list.data || !providers.data) {
    return <section className="page"><Loading error={list.error ?? providers.error} /></section>;
  }
  const shopify = providers.data.find((p) => p.kind === 'shopify');
  return (
    <section className="page">
      <h1>{tr('Online orders')}</h1>
      <p className="muted">{tr('Orders from your online store. Each one becomes an open sales order; stock still needs the normal approved request.')}</p>
      {!shopify?.enabled ? (
        <p className="small">
          {tr('Shopify is not switched on.')} <Link to="/settings/integrations#shopify">{tr('Connect it in Settings')}</Link>
        </p>
      ) : null}
      <Notice message={message} />
      {canManage && shopify?.enabled && shopify.mode === 'simulated' ? (
        <div className="form-row">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const r = await api<{ result: string; orderNumber?: string; reason?: string }>('/v1/sales/online-orders/test', { method: 'POST' });
                return r.result === 'imported' ? tr('A test order was created in Sales.') : (r.reason ?? r.result);
              }, list.reload)
            }
          >
            {tr('Send a test order')}
          </Button>
        </div>
      ) : null}
      {list.data.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{tr('Store order')}</th>
                <th scope="col">{tr('Status')}</th>
                <th scope="col" className="right">{tr('Total')}</th>
                <th scope="col">{tr('When')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <code>{o.shopify_name ?? o.shopify_order_id}</code>
                    {o.simulated ? <span className="muted small"> · {tr('Simulated')}</span> : null}
                  </td>
                  <td>
                    {o.status === 'imported' && o.sales_order_id ? <Link to={`/sales/orders/${o.sales_order_id}`}>{tr('Imported as a sales order')}</Link> : <span className="error small">{tr('Needs a person')}: {o.review_reason}</span>}
                  </td>
                  <td className="right">{o.total_minor !== null && o.currency ? formatMoney({ amountMinor: o.total_minor, currency: o.currency }) : '—'}</td>
                  <td className="nowrap">{formatDateTime(o.created_at, session.org)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">{tr('No orders from the store yet.')}</p>
      )}
    </section>
  );
}

import { formatMoney } from '@erp/shared';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { Link } from '../../../lib/router';
import { api } from '../../../lib/api';
import { formatDateTime } from '../../../lib/format';
import { tr } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';
import { Notice, useNotice } from '../../accounting/common';

// Under the Shopify card (sql/059): what arrived from the store, what is held for a person, and a simulated test order.
// An order that arrives becomes an open sales order; stock still needs the normal approved request.

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

export function OnlineOrders({ canManage, simulated }: { canManage: boolean; simulated: boolean }) {
  const session = useSession();
  const { message, busy, run } = useNotice();
  const list = useLoad(() => api<Online[]>('/v1/sales/online-orders'));
  if (!list.data) return <Loading error={list.error} rows={2} />;
  return (
    <div className="stack">
      <h4>{tr('Orders from the store')}</h4>
      <Notice message={message} />
      {canManage && simulated ? (
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
    </div>
  );
}

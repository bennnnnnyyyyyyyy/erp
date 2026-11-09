import { useState } from 'react';
import { RecordHistory } from '../../components/RecordHistory';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { formatMoney, hasPermission } from '@erp/shared';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { Party, SalesOrder, SOStatus } from '../../lib/demoTrade';
import { formatDateTime } from '../../lib/format';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Shipments } from './Shipments';
import { ConfirmButton } from '../../components/FormToggle';
import { NewOrderForm, PartyList, Pill, useCatalog } from '../trade/common';

import { tr } from '../../lib/i18n';
// DEMO ONLY: sample sales screens (wave 2 in TECHNICAL_PLAN.md section 3.5). A sales order does not move
// stock by itself: it raises a stock request, which still needs a manager's approval before it ships.

const money = (minor: number, currency = 'EGP') => formatMoney({ amountMinor: minor, currency });
const STATUS: Record<SOStatus, string> = {
  open: 'New order',
  stock_requested: 'Waiting for approval',
  approved: 'Approved, ready to ship',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function Customers() {
  return <PartyList title={tr('Customers')} endpoint="/v1/sales/customers" noun="customer" addPermission="sales.customers.manage" />;
}

export function SalesOrders() {
  const cat = useCatalog();
  const orders = useLoad(() => api<SalesOrder[]>('/v1/sales/orders'));
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers'));
  const session = useSession();
  const customer = (id: string) => customers.data?.find((c) => c.id === id)?.name ?? id;

  const columns: Column<SalesOrder>[] = [
    { key: 'number', label: tr('Order'), value: (o) => o.number, render: (o) => <Link to={`/sales/orders/${o.id}`}><code>{o.number}</code></Link> },
    { key: 'customer', label: tr('Customer'), value: (o) => customer(o.customerId) },
    { key: 'wh', label: tr('Ships from'), value: (o) => cat.warehouseName(o.warehouseId) },
    { key: 'status', label: tr('Status'), value: (o) => o.status, render: (o) => <Pill status={o.status} label={tr(STATUS[o.status])} /> },
    { key: 'total', label: tr('Total'), value: (o) => o.totalMinor, align: 'right', render: (o) => money(o.totalMinor, o.currency) },
    { key: 'when', label: tr('Ordered'), value: (o) => o.createdAt, render: (o) => <span className="nowrap">{formatDateTime(o.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page">
      <h1>{tr('Sales orders')}</h1>
      <p className="muted">{tr('Customer orders. Goods are issued through a manager-approved stock request.')}</p>
      {orders.data && customers.data && cat.ready ? (
        <ListView
          title={tr('Sales orders')}
          rows={orders.data}
          columns={columns}
          rowKey={(o) => o.id}
          rowHref={(o) => `/sales/orders/${o.id}`}
          empty={tr('No sales orders yet.')}
          toolbar={hasPermission(session.permissions, 'sales.orders.create') ? <Button type="submit" onClick={() => navigate('/sales/orders/new')}>{tr('New sales order')}</Button> : undefined}
        />
      ) : (
        <Loading />
      )}
    </section>
  );
}

export function NewSalesOrder() {
  return (
    <NewOrderForm
      title={tr('New sales order')}
      intro={tr('Stock is reserved only when a stock request is raised for the order.')}
      partyLabel="Customer"
      partyEndpoint="/v1/sales/customers"
      orderEndpoint="/v1/sales/orders"
      partyField="customerId"
      priceField="unitPriceMinor"
      priceLabel={tr('Unit price')}
      backTo="/sales/orders"
      backLabel={tr('Sales orders')}
      submitLabel={tr('Save order')}
      partyAddPermission="sales.customers.manage"
    />
  );
}

const STEPS: { key: SOStatus[]; label: string }[] = [
  { key: ['open'], label: 'Order placed' },
  { key: ['stock_requested'], label: 'Stock requested' },
  { key: ['approved'], label: 'Approved' },
  { key: ['delivered'], label: 'Delivered' },
];

function OrderSteps({ status }: { status: SOStatus }) {
  if (status === 'cancelled') return <p className="muted">{tr('This order was cancelled.')}</p>;
  const at = STEPS.findIndex((s) => s.key.includes(status));
  return (
    <ol className="steps wide" aria-label={tr('Order progress')}>
      {STEPS.map((s, i) => (
        <li key={s.label} className={`step ${i < at || status === 'delivered' ? 'done' : i === at ? 'current' : ''}`} data-n={i + 1}>
          {tr(s.label)}
        </li>
      ))}
    </ol>
  );
}

export function SalesOrderPage() {
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const order = useLoad(() => api<SalesOrder>(`/v1/sales/orders/${id}`));
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers'));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const o = order.data;
  const canFulfil = hasPermission(session.permissions, 'sales.orders.fulfill');
  const canManageOrder = hasPermission(session.permissions, 'sales.orders.manage');

  async function act(action: 'request-stock' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/sales/orders/${id}/${action}`, { method: 'POST' });
      setResult({ ok: true, text: tr(done) });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      order.reload();
    }
  }

  if (order.error) return <section className="page"><p className="error">{order.error}</p></section>;
  if (!o || !cat.ready || !customers.data) return <section className="page"><Loading /></section>;

  const customer = customers.data.find((c) => c.id === o.customerId);

  return (
    <section className="page">
      <Link to="/sales/orders" className="back-link">{tr('← Sales orders')}</Link>
      <div className="page-head">
        <h1 className="mono">{o.number}</h1>
        <Pill status={o.status} label={tr(STATUS[o.status])} />
      </div>
      <dl className="facts">
        <div><dt>{tr('Customer')}</dt><dd>{customer?.name}{customer?.city ? <span className="muted"> · {customer.city}</span> : ''}</dd></div>
        <div><dt>{tr('Ships from')}</dt><dd>{cat.warehouseName(o.warehouseId)}</dd></div>
        <div><dt>{tr('Ordered')}</dt><dd>{formatDateTime(o.createdAt, session.org)}</dd></div>
        <div><dt>{tr('Total')}</dt><dd className="amount">{money(o.totalMinor, o.currency)}</dd></div>
      </dl>
      <OrderSteps status={o.status} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Quantity')}</th><th scope="col" className="right">{tr('Unit price')}</th><th scope="col" className="right">{tr('Line total')}</th></tr>
          </thead>
          <tbody>
            {o.lines.map((l, i) => (
              <tr key={i}>
                <td>{cat.itemName(l.itemId)}</td>
                <td className="right">{l.qty}</td>
                <td className="right">{money(l.unitPriceMinor, o.currency)}</td>
                <td className="right">{money(l.qty * l.unitPriceMinor, o.currency)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} className="right"><strong>{tr('Total')}</strong></td>
              <td className="right"><strong>{money(o.totalMinor, o.currency)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {o.requestId && o.status !== 'open' && (
        <p className="notice">
          {tr('Stock request')} <Link to={`/inventory/requests/${o.requestId}`}><code>{o.requestNumber ?? tr('Open it')}</code></Link>
          {o.status === 'delivered' ? tr(' has been issued.') : tr(' needs a manager to approve it and the warehouse to issue it. Open it to continue.')}
        </p>
      )}
      {/* A rejected request used to drop the order back to "New" without a word (UX audit). */}
      {o.requestId && o.status === 'open' && (o.requestStatus === 'rejected' || o.requestStatus === 'cancelled') && (
        <p className="error notice">
          {o.requestStatus === 'rejected' ? tr('The stock request for this order was rejected.') : tr('The stock request for this order was cancelled.')}{' '}
          <Link to={`/inventory/requests/${o.requestId}`}>{tr('See why')}</Link>
          {' · '}{tr('You can request stock again below.')}
        </p>
      )}

      {o.status === 'open' && (canFulfil || canManageOrder) && (
        <div className="form-actions" style={{ marginBlockStart: '1rem' }}>
          {canFulfil && <Button type="submit" disabled={busy} onClick={() => act('request-stock', 'Stock requested. A manager now has to approve it.')}>{tr('Request stock from warehouse')}</Button>}
          {canManageOrder && (
            <ConfirmButton label={tr('Cancel order')} confirmLabel={tr('Yes, cancel it')} disabled={busy} question={tr('Cancel this order?')}
              onConfirm={() => act('cancel', 'Order cancelled.')} />
          )}
        </div>
      )}
      {o.status === 'delivered' && hasPermission(session.permissions, 'sales.invoices.manage') && (
        <div className="form-actions" style={{ marginBlockStart: '1rem' }}>
          <Button onClick={() => navigate(`/sales/invoices?order=${o.id}`)}>{tr('Create invoice')}</Button>
        </div>
      )}

      {o.status !== 'cancelled' && <Shipments orderId={o.id} customerName={customer?.name ?? ''} customerPhone={(customer as { phone?: string } | undefined)?.phone ?? ''} customerCity={(customer as { city?: string } | undefined)?.city ?? ''} />}

      <RecordHistory key={`${o.id}:${o.status}`} id={o.id} />
    </section>
  );
}

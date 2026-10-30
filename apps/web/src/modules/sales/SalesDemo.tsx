import { useState } from 'react';
import { formatMoney } from '@erp/shared';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { Party, SalesOrder, SOStatus } from '../../lib/demoTrade';
import { formatDateTime } from '../../lib/format';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { NewOrderForm, PartyList, Pill, useCatalog } from '../trade/common';

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
  return <PartyList title="Customers" endpoint="/v1/sales/customers" noun="customer" addPermission="sales.customers.manage" />;
}

export function SalesOrders() {
  const cat = useCatalog();
  const orders = useLoad(() => api<SalesOrder[]>('/v1/sales/orders'));
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers'));
  const session = useSession();
  const customer = (id: string) => customers.data?.find((c) => c.id === id)?.name ?? id;

  const columns: Column<SalesOrder>[] = [
    { key: 'number', label: 'Order', value: (o) => o.number, render: (o) => <Link to={`/sales/orders/${o.id}`}><code>{o.number}</code></Link> },
    { key: 'customer', label: 'Customer', value: (o) => customer(o.customerId) },
    { key: 'wh', label: 'Ships from', value: (o) => cat.warehouseName(o.warehouseId) },
    { key: 'status', label: 'Status', value: (o) => o.status, render: (o) => <Pill status={o.status} label={STATUS[o.status]} /> },
    { key: 'total', label: 'Total', value: (o) => o.totalMinor, align: 'right', render: (o) => money(o.totalMinor, o.currency) },
    { key: 'when', label: 'Ordered', value: (o) => o.createdAt, render: (o) => <span className="nowrap">{formatDateTime(o.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page">
      <h1>Sales orders</h1>
      <p className="muted">What customers have ordered. Shipping goes through a stock request that a manager approves.</p>
      {orders.data && customers.data && cat.ready ? (
        <ListView
          title="Sales orders"
          rows={orders.data}
          columns={columns}
          rowKey={(o) => o.id}
          empty="No sales orders yet."
          toolbar={session.role !== 'viewer' ? <button onClick={() => navigate('/sales/orders/new')}>New sales order</button> : undefined}
        />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </section>
  );
}

export function NewSalesOrder() {
  return (
    <NewOrderForm
      title="New sales order"
      intro="Record what a customer ordered. Stock is not touched until you request it from the warehouse."
      partyLabel="Customer"
      partyEndpoint="/v1/sales/customers"
      orderEndpoint="/v1/sales/orders"
      partyField="customerId"
      priceField="unitPriceMinor"
      priceLabel="Unit price"
      backTo="/sales/orders"
      backLabel="Sales orders"
      submitLabel="Save order"
    />
  );
}

const STEPS: { key: SOStatus[]; label: string }[] = [
  { key: ['open'], label: 'Order taken' },
  { key: ['stock_requested'], label: 'Stock requested' },
  { key: ['approved'], label: 'Approved' },
  { key: ['delivered'], label: 'Delivered' },
];

function OrderSteps({ status }: { status: SOStatus }) {
  if (status === 'cancelled') return <p className="muted">This order was cancelled.</p>;
  const at = STEPS.findIndex((s) => s.key.includes(status));
  return (
    <ol className="steps wide" aria-label="Order progress">
      {STEPS.map((s, i) => (
        <li key={s.label} className={`step ${i < at || status === 'delivered' ? 'done' : i === at ? 'current' : ''}`} data-n={i + 1}>
          {s.label}
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
  const audit = useLoad(() => api<{ id: number; occurred_at: string; action: string; summary: string | null; entity_id: string | null }[]>('/v1/core/audit?limit=200'));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const o = order.data;

  async function act(action: 'request-stock' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/sales/orders/${id}/${action}`, { method: 'POST' });
      setResult({ ok: true, text: done });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      order.reload();
      audit.reload();
    }
  }

  if (order.error) return <section className="page"><p className="error">{order.error}</p></section>;
  if (!o || !cat.ready || !customers.data) return <section className="page"><p className="muted">Loading…</p></section>;

  const customer = customers.data.find((c) => c.id === o.customerId);
  const history = (audit.data ?? []).filter((a) => a.entity_id === o.id);

  return (
    <section className="page">
      <Link to="/sales/orders" className="back-link">← Sales orders</Link>
      <div className="page-head">
        <h1 className="mono">{o.number}</h1>
        <Pill status={o.status} label={STATUS[o.status]} />
      </div>
      <p className="muted">
        {customer?.name} ({customer?.city}) · ships from {cat.warehouseName(o.warehouseId)} · ordered {formatDateTime(o.createdAt, session.org)}
      </p>
      <OrderSteps status={o.status} />

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Item</th><th className="right">Quantity</th><th className="right">Unit price</th><th className="right">Line total</th></tr>
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
              <td colSpan={3} className="right"><strong>Total</strong></td>
              <td className="right"><strong>{money(o.totalMinor, o.currency)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {o.requestId && o.status !== 'open' && (
        <p className="notice">
          Stock request <Link to={`/inventory/requests/${o.requestId}`}><code>{`OUT-${o.requestId.slice(1).padStart(4, '0')}`}</code></Link>
          {o.status === 'delivered' ? ' has been issued.' : ' needs a manager to approve it and the warehouse to issue it. Open it to continue.'}
        </p>
      )}

      {o.status === 'open' && session.role !== 'viewer' && (
        <div className="form-actions" style={{ marginBlockStart: '1rem' }}>
          <button disabled={busy} onClick={() => act('request-stock', 'Stock requested. A manager now has to approve it.')}>Request stock from warehouse</button>
          <button className="secondary" disabled={busy} onClick={() => act('cancel', 'Order cancelled.')}>Cancel order</button>
        </div>
      )}

      <h2 className="related">History</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id}><td className="nowrap">{formatDateTime(a.occurred_at, session.org)}</td><td><code>{a.action}</code></td><td>{a.summary}</td></tr>
            ))}
            {history.length === 0 && <tr><td colSpan={3} className="muted empty">No history yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

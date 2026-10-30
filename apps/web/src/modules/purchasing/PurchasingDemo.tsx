import { useState } from 'react';
import { formatMoney } from '@erp/shared';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { Party, PurchaseOrder } from '../../lib/demoTrade';
import { formatDateTime } from '../../lib/format';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { NewOrderForm, PartyList, Pill, useCatalog } from '../trade/common';

// The demo and real module use the same response shape; the real receipt posts to the inventory ledger.

const money = (minor: number, currency = 'EGP') => formatMoney({ amountMinor: minor, currency });
const STATUS: Record<PurchaseOrder['status'], string> = { ordered: 'Waiting for goods', received: 'Received', cancelled: 'Cancelled' };

export function Suppliers() {
  return <PartyList title="Suppliers" endpoint="/v1/purchasing/suppliers" noun="supplier" />;
}

export function PurchaseOrders() {
  const cat = useCatalog();
  const orders = useLoad(() => api<PurchaseOrder[]>('/v1/purchasing/orders'));
  const suppliers = useLoad(() => api<Party[]>('/v1/purchasing/suppliers'));
  const session = useSession();
  const supplier = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? id;

  const columns: Column<PurchaseOrder>[] = [
    { key: 'number', label: 'Order', value: (o) => o.number, render: (o) => <Link to={`/purchasing/orders/${o.id}`}><code>{o.number}</code></Link> },
    { key: 'supplier', label: 'Supplier', value: (o) => supplier(o.supplierId) },
    { key: 'wh', label: 'Deliver to', value: (o) => cat.warehouseName(o.warehouseId) },
    { key: 'status', label: 'Status', value: (o) => o.status, render: (o) => <Pill status={o.status} label={STATUS[o.status]} /> },
    { key: 'total', label: 'Total', value: (o) => o.totalMinor, align: 'right', render: (o) => money(o.totalMinor, o.currency) },
    { key: 'when', label: 'Ordered', value: (o) => o.createdAt, render: (o) => <span className="nowrap">{formatDateTime(o.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page">
      <h1>Purchase orders</h1>
      <p className="muted">Goods you have ordered from suppliers. Receiving an order puts the goods into stock.</p>
      {orders.data && suppliers.data && cat.ready ? (
        <ListView
          title="Purchase orders"
          rows={orders.data}
          columns={columns}
          rowKey={(o) => o.id}
          empty="No purchase orders yet."
          toolbar={session.role !== 'viewer' ? <button onClick={() => navigate('/purchasing/orders/new')}>New purchase order</button> : undefined}
        />
      ) : (
        <p className="muted">Loading…</p>
      )}
    </section>
  );
}

export function NewPurchaseOrder() {
  return (
    <NewOrderForm
      title="New purchase order"
      intro="Order goods from a supplier. Nothing changes in stock until the goods arrive and you receive the order."
      partyLabel="Supplier"
      partyEndpoint="/v1/purchasing/suppliers"
      orderEndpoint="/v1/purchasing/orders"
      partyField="supplierId"
      priceField="unitCostMinor"
      priceLabel="Unit cost"
      backTo="/purchasing/orders"
      backLabel="Purchase orders"
      submitLabel="Place order"
    />
  );
}

export function PurchaseOrderPage() {
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const order = useLoad(() => api<PurchaseOrder>(`/v1/purchasing/orders/${id}`));
  const suppliers = useLoad(() => api<Party[]>('/v1/purchasing/suppliers'));
  const audit = useLoad(() => api<{ id: number; occurred_at: string; action: string; summary: string | null; entity_id: string | null }[]>('/v1/core/audit?limit=200'));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const o = order.data;

  async function act(action: 'receive' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/purchasing/orders/${id}/${action}`, { method: 'POST' });
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
  if (!o || !cat.ready || !suppliers.data) return <section className="page"><p className="muted">Loading…</p></section>;

  const supplier = suppliers.data.find((s) => s.id === o.supplierId);
  const history = (audit.data ?? []).filter((a) => a.entity_id === o.id);

  return (
    <section className="page">
      <Link to="/purchasing/orders" className="back-link">← Purchase orders</Link>
      <div className="page-head">
        <h1 className="mono">{o.number}</h1>
        <Pill status={o.status} label={STATUS[o.status]} />
      </div>
      <p className="muted">
        {supplier?.name} ({supplier?.city}) · deliver to {cat.warehouseName(o.warehouseId)} · ordered {formatDateTime(o.createdAt, session.org)}
        {o.receivedAt && <> · received {formatDateTime(o.receivedAt, session.org)}</>}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Item</th><th className="right">Quantity</th><th className="right">Unit cost</th><th className="right">Line total</th></tr>
          </thead>
          <tbody>
            {o.lines.map((l, i) => (
              <tr key={i}>
                <td>{cat.itemName(l.itemId)}</td>
                <td className="right">{l.qty}</td>
                <td className="right">{money(l.unitCostMinor, o.currency)}</td>
                <td className="right">{money(l.qty * l.unitCostMinor, o.currency)}</td>
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

      {o.status === 'ordered' && session.role !== 'viewer' && (
        <div className="form-actions" style={{ marginBlockStart: '1rem' }}>
          <button disabled={busy} onClick={() => act('receive', 'Goods received. The quantities were added to stock and the ledger.')}>Receive goods</button>
          <button className="secondary" disabled={busy} onClick={() => act('cancel', 'Order cancelled.')}>Cancel order</button>
        </div>
      )}
      {o.status === 'received' && (
        <p className="notice">The goods are in stock. <Link to="/inventory/ledger">See the receipts in the stock ledger</Link> or <Link to="/inventory">check stock on hand</Link>.</p>
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

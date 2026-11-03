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

import { tr } from '../../lib/i18n';
// The demo and real module use the same response shape; the real receipt posts to the inventory ledger.

const money = (minor: number, currency = 'EGP') => formatMoney({ amountMinor: minor, currency });
const STATUS: Record<PurchaseOrder['status'], string> = { ordered: 'Waiting for goods', received: 'Received', cancelled: 'Cancelled' };

export function Suppliers() {
  return <PartyList title={tr('Suppliers')} endpoint="/v1/purchasing/suppliers" noun="supplier" />;
}

export function PurchaseOrders() {
  const cat = useCatalog();
  const orders = useLoad(() => api<PurchaseOrder[]>('/v1/purchasing/orders'));
  const suppliers = useLoad(() => api<Party[]>('/v1/purchasing/suppliers'));
  const session = useSession();
  const supplier = (id: string) => suppliers.data?.find((s) => s.id === id)?.name ?? id;

  const columns: Column<PurchaseOrder>[] = [
    { key: 'number', label: tr('Order'), value: (o) => o.number, render: (o) => <Link to={`/purchasing/orders/${o.id}`}><code>{o.number}</code></Link> },
    { key: 'supplier', label: tr('Supplier'), value: (o) => supplier(o.supplierId) },
    { key: 'wh', label: tr('Deliver to'), value: (o) => cat.warehouseName(o.warehouseId) },
    { key: 'status', label: tr('Status'), value: (o) => o.status, render: (o) => <Pill status={o.status} label={tr(STATUS[o.status])} /> },
    { key: 'total', label: tr('Total'), value: (o) => o.totalMinor, align: 'right', render: (o) => money(o.totalMinor, o.currency) },
    { key: 'when', label: tr('Ordered'), value: (o) => o.createdAt, render: (o) => <span className="nowrap">{formatDateTime(o.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page">
      <h1>{tr('Purchase orders')}</h1>
      <p className="muted">{tr('Goods you have ordered from suppliers. Receiving an order puts the goods into stock.')}</p>
      {orders.data && suppliers.data && cat.ready ? (
        <ListView
          title={tr('Purchase orders')}
          rows={orders.data}
          columns={columns}
          rowKey={(o) => o.id}
          rowHref={(o) => `/purchasing/orders/${o.id}`}
          empty={tr('No purchase orders yet.')}
          toolbar={session.role !== 'viewer' ? <button onClick={() => navigate('/purchasing/orders/new')}>{tr('New purchase order')}</button> : undefined}
        />
      ) : (
        <p className="muted">{tr('Loading…')}</p>
      )}
    </section>
  );
}

export function NewPurchaseOrder() {
  return (
    <NewOrderForm
      title={tr('New purchase order')}
      intro={tr('Order goods from a supplier. Nothing changes in stock until the goods arrive and you receive the order.')}
      partyLabel="Supplier"
      partyEndpoint="/v1/purchasing/suppliers"
      orderEndpoint="/v1/purchasing/orders"
      partyField="supplierId"
      priceField="unitCostMinor"
      priceLabel={tr('Unit cost')}
      backTo="/purchasing/orders"
      backLabel={tr('Purchase orders')}
      submitLabel={tr('Place order')}
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
  if (!o || !cat.ready || !suppliers.data) return <section className="page"><p className="muted">{tr('Loading…')}</p></section>;

  const supplier = suppliers.data.find((s) => s.id === o.supplierId);
  const history = (audit.data ?? []).filter((a) => a.entity_id === o.id);

  return (
    <section className="page">
      <Link to="/purchasing/orders" className="back-link">{tr('← Purchase orders')}</Link>
      <div className="page-head">
        <h1 className="mono">{o.number}</h1>
        <Pill status={o.status} label={tr(STATUS[o.status])} />
      </div>
      <p className="muted">
        {supplier?.name} ({supplier?.city}{tr(') · deliver to')} {cat.warehouseName(o.warehouseId)} {tr('· ordered')} {formatDateTime(o.createdAt, session.org)}
        {o.receivedAt && <> {tr('· received')} {formatDateTime(o.receivedAt, session.org)}</>}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>{tr('Item')}</th><th className="right">{tr('Quantity')}</th><th className="right">{tr('Unit cost')}</th><th className="right">{tr('Line total')}</th></tr>
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
              <td colSpan={3} className="right"><strong>{tr('Total')}</strong></td>
              <td className="right"><strong>{money(o.totalMinor, o.currency)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {o.status === 'ordered' && session.role !== 'viewer' && (
        <div className="form-actions" style={{ marginBlockStart: '1rem' }}>
          <button disabled={busy} onClick={() => act('receive', 'Goods received. The quantities were added to stock and the ledger.')}>{tr('Receive goods')}</button>
          <button className="secondary" disabled={busy} onClick={() => act('cancel', 'Order cancelled.')}>{tr('Cancel order')}</button>
        </div>
      )}
      {o.status === 'received' && (
        <p className="notice">{tr('The goods are in stock.')} <Link to="/inventory/ledger">{tr('See the receipts in the stock ledger')}</Link> or <Link to="/inventory">{tr('check stock on hand')}</Link>.</p>
      )}

      <h2 className="related">{tr('History')}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr('When')}</th><th>{tr('Action')}</th><th>{tr('Details')}</th></tr></thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id}><td className="nowrap">{formatDateTime(a.occurred_at, session.org)}</td><td><code>{a.action}</code></td><td>{a.summary}</td></tr>
            ))}
            {history.length === 0 && <tr><td colSpan={3} className="muted empty">{tr('No history yet.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

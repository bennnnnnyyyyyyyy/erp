import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { formatMoney, hasPermission } from '@erp/shared';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import type { Party, PurchaseOrder } from '../../lib/demoTrade';
import { formatDateTime } from '../../lib/format';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { NewOrderForm, PartyList, Pill, useCatalog } from '../trade/common';
import { ConfirmButton } from '../../components/FormToggle';

import { tr } from '../../lib/i18n';
// The demo and real module use the same response shape; the real receipt posts to the inventory ledger.

const money = (minor: number, currency = 'EGP') => formatMoney({ amountMinor: minor, currency });
const STATUS: Record<PurchaseOrder['status'], string> = { ordered: 'Awaiting receipt', received: 'Received', cancelled: 'Cancelled' };

export function Suppliers() {
  return <PartyList title={tr('Suppliers')} endpoint="/v1/purchasing/suppliers" noun="supplier" addPermission="purchasing.suppliers.manage" />;
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
      <p className="muted">{tr('Purchase orders to suppliers. Goods receipt posts the quantities to stock.')}</p>
      {orders.data && suppliers.data && cat.ready ? (
        <ListView
          title={tr('Purchase orders')}
          rows={orders.data}
          columns={columns}
          rowKey={(o) => o.id}
          rowHref={(o) => `/purchasing/orders/${o.id}`}
          empty={tr('No purchase orders yet.')}
          toolbar={hasPermission(session.permissions, 'purchasing.orders.create') ? <Button type="submit" onClick={() => navigate('/purchasing/orders/new')}>{tr('New purchase order')}</Button> : undefined}
        />
      ) : (
        <Loading />
      )}
    </section>
  );
}

export function NewPurchaseOrder() {
  return (
    <NewOrderForm
      title={tr('New purchase order')}
      intro={tr('Stock is updated only when goods are received against the order.')}
      partyLabel="Supplier"
      partyEndpoint="/v1/purchasing/suppliers"
      orderEndpoint="/v1/purchasing/orders"
      partyField="supplierId"
      priceField="unitCostMinor"
      priceLabel={tr('Unit cost')}
      backTo="/purchasing/orders"
      backLabel={tr('Purchase orders')}
      submitLabel={tr('Place order')}
      partyAddPermission="purchasing.suppliers.manage"
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
  const canReceive = hasPermission(session.permissions, 'purchasing.orders.receive');
  const canManageOrder = hasPermission(session.permissions, 'purchasing.orders.manage');

  async function act(action: 'receive' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/purchasing/orders/${id}/${action}`, { method: 'POST' });
      setResult({ ok: true, text: tr(done) });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      order.reload();
      audit.reload();
    }
  }

  if (order.error) return <section className="page"><p className="error">{order.error}</p></section>;
  if (!o || !cat.ready || !suppliers.data) return <section className="page"><Loading /></section>;

  const supplier = suppliers.data.find((s) => s.id === o.supplierId);
  const history = (audit.data ?? []).filter((a) => a.entity_id === o.id);

  return (
    <section className="page">
      <Link to="/purchasing/orders" className="back-link">{tr('← Purchase orders')}</Link>
      <div className="page-head">
        <h1 className="mono">{o.number}</h1>
        <Pill status={o.status} label={tr(STATUS[o.status])} />
      </div>
      <dl className="facts">
        <div><dt>{tr('Supplier')}</dt><dd>{supplier?.name}{supplier?.city ? <span className="muted"> · {supplier.city}</span> : ''}</dd></div>
        <div><dt>{tr('Deliver to')}</dt><dd>{cat.warehouseName(o.warehouseId)}</dd></div>
        <div><dt>{tr('Ordered')}</dt><dd>{formatDateTime(o.createdAt, session.org)}</dd></div>
        {o.receivedAt && <div><dt>{tr('Received')}</dt><dd>{formatDateTime(o.receivedAt, session.org)}</dd></div>}
        <div><dt>{tr('Total')}</dt><dd className="amount">{money(o.totalMinor, o.currency)}</dd></div>
      </dl>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Quantity')}</th><th scope="col" className="right">{tr('Unit cost')}</th><th scope="col" className="right">{tr('Line total')}</th></tr>
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

      {o.status === 'ordered' && (canReceive || canManageOrder) && (
        <div className="form-actions" style={{ marginBlockStart: '1rem' }}>
          {/* Receiving takes every line in full (partial receipts are not built yet), so say so before it happens (UX audit). */}
          {canReceive && (
            <ConfirmButton label={tr('Receive goods')} confirmLabel={tr('Yes, receive all')} disabled={busy}
              question={tr('Receive every line of this order in full? For a short delivery, do not receive it here yet.')}
              onConfirm={() => act('receive', 'Goods received. The quantities were added to stock and the ledger.')} />
          )}
          {canManageOrder && (
            <ConfirmButton label={tr('Cancel order')} confirmLabel={tr('Yes, cancel it')} disabled={busy} question={tr('Cancel this order?')}
              onConfirm={() => act('cancel', 'Order cancelled.')} />
          )}
        </div>
      )}
      {o.status === 'received' && (
        <p className="notice">{tr('The goods are in stock.')} <Link to="/inventory/ledger">{tr('See the receipts in the stock ledger')}</Link> or <Link to="/inventory">{tr('check stock on hand')}</Link>.</p>
      )}

      <h2 className="related">{tr('History')}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('When')}</th><th scope="col">{tr('Action')}</th><th scope="col">{tr('Details')}</th></tr></thead>
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

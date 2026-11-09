import { useState, type FormEvent } from 'react';
import { parseAmount } from '../../lib/numbers';
import { RecordHistory } from '../../components/RecordHistory';
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

import { tr, trf } from '../../lib/i18n';
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
    { key: 'status', label: tr('Status'), value: (o) => o.status, render: (o) => <Pill status={o.status} label={tr(o.partlyReceived ? 'Partly received' : STATUS[o.status])} /> },
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

/** Decision D3 (sql/064): enter what actually arrived on each line. When less than ordered arrived, ask "Is the rest still coming?":
 *  yes keeps the order open (Partly received), no closes it short. Blank or 0 on a line means none of it came this time. */
function ReceiveForm({ order, itemName, onDone, onCancel }: {
  order: PurchaseOrder;
  itemName: (id: string) => string;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const open = order.lines.filter((l) => l.lineId && l.qty - (l.receivedQty ?? 0) > 0);
  const left = (l: PurchaseOrder['lines'][number]) => l.qty - (l.receivedQty ?? 0);
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.lineId as string, String(left(l))])));
  const [restComing, setRestComing] = useState<'' | 'yes' | 'no'>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = open.map((l) => {
    const text = qtys[l.lineId as string] ?? '';
    return { line: l, qty: text.trim() === '' ? 0 : parseAmount(text) };
  });
  const bad = parsed.find((p) => !Number.isFinite(p.qty) || p.qty < 0 || p.qty > left(p.line));
  const total = parsed.reduce((a, p) => a + (Number.isFinite(p.qty) ? p.qty : 0), 0);
  const short = parsed.some((p) => p.qty < left(p.line));
  // Closing an order that is already partly received is allowed with nothing arriving now; a fresh order with nothing is a cancellation.
  const nothing = total === 0 && !(order.partlyReceived && restComing === 'no');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (bad) return setError(trf('Check the quantity for {item}: from 0 up to {n}.', { item: itemName(bad.line.itemId), n: left(bad.line) }));
    if (short && !restComing) return setError(tr('Say whether the rest is still coming.'));
    setBusy(true);
    try {
      await api(`/v1/purchasing/orders/${order.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({ lines: parsed.map((p) => ({ lineId: p.line.lineId, qty: p.qty })), restComing: short ? restComing === 'yes' : false }),
      });
      onDone(
        !short
          ? tr('Goods received. The quantities were added to stock and the ledger.')
          : restComing === 'yes'
            ? tr('Received what arrived. The order stays open for the rest.')
            : tr('Received what arrived. The order is closed; the rest will not come.'),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card stack" onSubmit={submit} style={{ marginBlockStart: '1rem' }}>
      <strong>{tr('What arrived?')}</strong>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Still to come')}</th><th scope="col" className="right">{tr('Arrived now')}</th></tr>
          </thead>
          <tbody>
            {open.map((l) => (
              <tr key={l.lineId}>
                <td>{itemName(l.itemId)}</td>
                <td className="right">{left(l)}</td>
                <td className="right">
                  <input className="w-24" inputMode="decimal" aria-label={trf('Arrived now: {item}', { item: itemName(l.itemId) })}
                    value={qtys[l.lineId as string] ?? ''} onChange={(e) => setQtys((q) => ({ ...q, [l.lineId as string]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {short && (
        <fieldset className="stack">
          <legend>{tr('Is the rest still coming?')}</legend>
          <label><input type="radio" name="rest" checked={restComing === 'yes'} onChange={() => setRestComing('yes')} /> {tr('Yes, keep the order open for the rest')}</label>
          <label><input type="radio" name="rest" checked={restComing === 'no'} onChange={() => setRestComing('no')} /> {tr('No, close the order: the rest will not come')}</label>
        </fieldset>
      )}
      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <Button type="submit" disabled={busy || nothing}>{total === 0 ? tr('Close the order') : tr('Receive into stock')}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>{tr('Cancel')}</Button>
      </div>
    </form>
  );
}

export function PurchaseOrderPage() {
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const order = useLoad(() => api<PurchaseOrder>(`/v1/purchasing/orders/${id}`));
  const suppliers = useLoad(() => api<Party[]>('/v1/purchasing/suppliers'));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const o = order.data;
  const canReceive = hasPermission(session.permissions, 'purchasing.orders.receive');
  const canManageOrder = hasPermission(session.permissions, 'purchasing.orders.manage');
  // The real API gives line ids and received quantities (sql/064); the sample data receives orders whole.
  const byLine = Boolean(o?.lines.every((l) => l.lineId));

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
    }
  }

  if (order.error) return <section className="page"><p className="error">{order.error}</p></section>;
  if (!o || !cat.ready || !suppliers.data) return <section className="page"><Loading /></section>;

  const supplier = suppliers.data.find((s) => s.id === o.supplierId);

  return (
    <section className="page">
      <Link to="/purchasing/orders" className="back-link">{tr('← Purchase orders')}</Link>
      <div className="page-head">
        <h1 className="mono">{o.number}</h1>
        <Pill status={o.status} label={tr(o.partlyReceived ? 'Partly received' : STATUS[o.status])} />
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
            <tr>
              <th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Quantity')}</th>
              {byLine && <th scope="col" className="right">{tr('Received')}</th>}
              <th scope="col" className="right">{tr('Unit cost')}</th><th scope="col" className="right">{tr('Line total')}</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l, i) => (
              <tr key={i}>
                <td>{cat.itemName(l.itemId)}</td>
                <td className="right">{l.qty}</td>
                {byLine && <td className="right">{l.receivedQty ?? 0}</td>}
                <td className="right">{money(l.unitCostMinor, o.currency)}</td>
                <td className="right">{money(l.qty * l.unitCostMinor, o.currency)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={byLine ? 4 : 3} className="right"><strong>{tr('Total')}</strong></td>
              <td className="right"><strong>{money(o.totalMinor, o.currency)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {o.status === 'ordered' && receiving && (
        <ReceiveForm order={o} itemName={cat.itemName} onCancel={() => setReceiving(false)}
          onDone={(text) => { setReceiving(false); setResult({ ok: true, text }); order.reload(); }} />
      )}
      {o.status === 'ordered' && !receiving && (canReceive || canManageOrder) && (
        <div className="form-actions" style={{ marginBlockStart: '1rem' }}>
          {canReceive && byLine && (
            <Button type="submit" disabled={busy} onClick={() => { setResult(null); setReceiving(true); }}>{tr('Receive goods')}</Button>
          )}
          {/* The sample data has no line ids, so it keeps the one-step receipt of the whole order. */}
          {canReceive && !byLine && (
            <ConfirmButton label={tr('Receive goods')} confirmLabel={tr('Yes, receive all')} disabled={busy}
              question={tr('Receive every line of this order in full?')}
              onConfirm={() => act('receive', 'Goods received. The quantities were added to stock and the ledger.')} />
          )}
          {/* Goods already in are real stock, so a partly received order is closed short, not cancelled (sql/064). */}
          {canManageOrder && !o.partlyReceived && (
            <ConfirmButton label={tr('Cancel order')} confirmLabel={tr('Yes, cancel it')} disabled={busy} question={tr('Cancel this order?')}
              onConfirm={() => act('cancel', 'Order cancelled.')} />
          )}
        </div>
      )}
      {o.status === 'received' && (
        <p className="notice">{tr('The goods are in stock.')} <Link to="/inventory/ledger">{tr('See the receipts in the stock ledger')}</Link> or <Link to="/inventory">{tr('check stock on hand')}</Link>.</p>
      )}

      <RecordHistory key={`${o.id}:${o.status}`} id={o.id} />
    </section>
  );
}

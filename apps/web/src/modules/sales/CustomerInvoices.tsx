import { useMemo, useState } from 'react';
import { billingFor, formatMoney, type BillingFlag } from '@erp/shared';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Button } from '../../components/ui/button';
import { ClickRow } from '../../components/ClickRow';
import { RecordHistory } from '../../components/RecordHistory';
import { Link, useParam } from '../../lib/router';
import { PaymentsAgainst } from '../finance/FinanceRecords';
import { Pill } from '../trade/common';

import { tr, trf } from '../../lib/i18n';
// Customer invoices: bill a delivered sales order, line by line, and see ordered / delivered / invoiced with a flag for
// whatever does not match. The price always comes from the order line; the database refuses over-invoicing.

type OrderLine = { id: string; itemId: string; qty: number; unitPriceMinor: number };
type Order = { id: string; number: string; customerId: string; status: string; currency: string; requestStatus: string | null; lines: OrderLine[] };
type Invoice = { id: string; number: string; orderId: string; customerId: string; invoiceDate: string; currency: string; status: 'issued' | 'void'; totalMinor: number; createdAt: string; lines: { orderLineId: string; qty: number; unitPriceMinor: number }[] };
type Customer = { id: string; name: string };
type Item = { id: string; sku: string; name: string };

const FLAG: Record<BillingFlag, { label: string; pill: string }> = {
  ok: { label: 'Fully invoiced', pill: 'received' },
  under_invoiced: { label: 'Not fully invoiced', pill: 'submitted' },
  not_delivered: { label: 'Not delivered yet', pill: 'ordered' },
  over_invoiced: { label: 'Invoiced more than delivered', pill: 'rejected' },
};
const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency });

export function CustomerInvoices() {
  const session = useSession();
  const orders = useLoad(() => api<Order[]>('/v1/sales/orders'));
  const invoices = useLoad(() => api<Invoice[]>('/v1/sales/invoices'));
  const customers = useLoad(() => api<Customer[]>('/v1/sales/customers'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));
  const [orderId, setOrderId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const invoicedByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of invoices.data ?? []) if (i.status === 'issued') for (const l of i.lines) m.set(l.orderLineId, (m.get(l.orderLineId) ?? 0) + l.qty);
    return m;
  }, [invoices.data]);

  if (!orders.data || !invoices.data || !customers.data || !items.data) return <section className="page"><p className="muted">{orders.error ?? invoices.error ?? tr('Loading…')}</p></section>;

  const customer = (id: string) => customers.data?.find((c) => c.id === id)?.name ?? 'Unknown customer';
  const item = (id: string) => { const i = items.data?.find((v) => v.id === id); return i ? `${i.sku} · ${i.name}` : id; };
  const rows = orders.data.filter((o) => o.status !== 'cancelled').map((o) => ({ o, billing: billingFor(o.lines.map((l) => ({ orderLineId: l.id, itemId: l.itemId, qty: l.qty })), o.requestStatus, invoicedByLine) }));
  const open = rows.filter((r) => r.billing.some((b) => b.flag === 'under_invoiced'));
  const chosen = rows.find((r) => r.o.id === orderId);
  const canManage = session.permissions.includes('sales.invoices.manage');

  async function create() {
    if (!chosen) return;
    setBusy(true); setMessage(null);
    try {
      const lines = chosen.billing.filter((b) => Number(qty[b.orderLineId]) > 0).map((b) => ({ orderLineId: b.orderLineId, qty: Number(qty[b.orderLineId]) }));
      const made = await api<{ number: string }>(`/v1/sales/orders/${chosen.o.id}/invoices`, { method: 'POST', body: JSON.stringify({ invoiceDate: date, lines }) });
      setMessage({ ok: true, text: trf('Invoice {number} created.', { number: made.number }) }); setOrderId(''); setQty({});
      invoices.reload();
    } catch (e) { setMessage({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function voidInvoice(id: string) {
    setBusy(true); setMessage(null);
    try { await api(`/v1/sales/invoices/${id}/void`, { method: 'POST' }); setMessage({ ok: true, text: tr('Invoice voided. Its quantity can be invoiced again.') }); invoices.reload(); }
    catch (e) { setMessage({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <section className="page wide">
      <h1>{tr('Customer invoices')}</h1>
      <p className="muted">{tr('Bill delivered sales orders. An order can only be invoiced once its stock has been issued, and never for more than was delivered. A wrong invoice is voided, not edited.')}</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      {canManage && (
        <div className="form-card stack">
          <h2>{tr('Create an invoice')}</h2>
          <div className="form-row">
            <label>{tr('Delivered sales order')}
              <select value={orderId} onChange={(e) => { setOrderId(e.target.value); setQty({}); }}>
                <option value="">{tr('Choose an order…')}</option>
                {open.map((r) => <option key={r.o.id} value={r.o.id}>{r.o.number} · {customer(r.o.customerId)}</option>)}
              </select>
            </label>
            <label>{tr('Invoice date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          </div>
          {chosen && (
            <>
              <div className="table-wrap"><table><thead><tr><th>{tr('Item')}</th><th className="right">{tr('Delivered')}</th><th className="right">{tr('Already invoiced')}</th><th>{tr('Invoice now')}</th></tr></thead><tbody>
                {chosen.billing.map((b) => (
                  <tr key={b.orderLineId}><td>{item(b.itemId)}</td><td className="right">{b.delivered}</td><td className="right">{b.invoiced}</td>
                    <td><input type="number" min="0" max={b.delivered - b.invoiced} step="0.001" aria-label={trf('Quantity to invoice for {item}', { item: item(b.itemId) })} value={qty[b.orderLineId] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [b.orderLineId]: e.target.value }))} /></td></tr>
                ))}
              </tbody></table></div>
              <Button disabled={busy || !Object.values(qty).some((v) => Number(v) > 0)} onClick={create}>{busy ? tr('Creating…') : tr('Create invoice')}</Button>
            </>
          )}
        </div>
      )}

      <h2 className="related">{tr('Ordered, delivered and invoiced')}</h2>
      <div className="table-wrap"><table><thead><tr><th>{tr('Order')}</th><th>{tr('Customer')}</th><th className="right">{tr('Ordered')}</th><th className="right">{tr('Delivered')}</th><th className="right">{tr('Invoiced')}</th><th>{tr('Status')}</th></tr></thead><tbody>
        {rows.map(({ o, billing }) => {
          const sum = (k: 'ordered' | 'delivered' | 'invoiced') => billing.reduce((n, b) => n + b[k], 0);
          const worst = billing.find((b) => b.flag === 'over_invoiced') ?? billing.find((b) => b.flag === 'under_invoiced') ?? billing.find((b) => b.flag === 'not_delivered') ?? billing[0];
          const f = worst ? FLAG[worst.flag] : FLAG.not_delivered;
          return <ClickRow key={o.id} to={`/sales/orders/${o.id}`}><td><Link to={`/sales/orders/${o.id}`}><code>{o.number}</code></Link></td><td>{customer(o.customerId)}</td><td className="right">{sum('ordered')}</td><td className="right">{sum('delivered')}</td><td className="right">{sum('invoiced')}</td><td><Pill status={f.pill} label={tr(f.label)} /></td></ClickRow>;
        })}
        {!rows.length && <tr><td colSpan={6} className="muted empty">{tr('No sales orders yet.')}</td></tr>}
      </tbody></table></div>

      <h2 className="related">{tr('Invoices')}</h2>
      <div className="table-wrap"><table><thead><tr><th>{tr('Invoice')}</th><th>{tr('Customer')}</th><th>{tr('Order')}</th><th>{tr('Created')}</th><th className="right">{tr('Amount')}</th><th>{tr('Status')}</th><th></th></tr></thead><tbody>
        {invoices.data.map((i) => (
          <ClickRow key={i.id} to={`/sales/invoices/${i.id}`}><td><Link to={`/sales/invoices/${i.id}`}><code>{i.number}</code></Link></td><td>{customer(i.customerId)}</td><td><Link to={`/sales/orders/${i.orderId}`}><code>{orders.data?.find((o) => o.id === i.orderId)?.number ?? '—'}</code></Link></td><td>{formatDateTime(i.createdAt, session.org)}</td><td className="right">{money(i.totalMinor, i.currency)}</td>
            <td><Pill status={i.status === 'void' ? 'cancelled' : 'received'} label={i.status === 'void' ? tr('Void') : tr('Issued')} /></td>
            <td>{canManage && i.status === 'issued' && <Button variant="outline" size="sm" disabled={busy} onClick={() => voidInvoice(i.id)}>{tr('Void')}</Button>}</td></ClickRow>
        ))}
        {!invoices.data.length && <tr><td colSpan={7} className="muted empty">{tr('No invoices yet.')}</td></tr>}
      </tbody></table></div>
    </section>
  );
}

/** One customer invoice: who, which order, its lines and total, the payments against it, and its history. */
export function CustomerInvoicePage() {
  const id = useParam('id');
  const session = useSession();
  const invoices = useLoad(() => api<Invoice[]>('/v1/sales/invoices'));
  const orders = useLoad(() => api<Order[]>('/v1/sales/orders'));
  const customers = useLoad(() => api<Customer[]>('/v1/sales/customers'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (invoices.error) return <section className="page"><p className="error">{invoices.error}</p></section>;
  if (!invoices.data || !orders.data || !customers.data || !items.data) return <section className="page"><p className="muted">{tr('Loading…')}</p></section>;
  const inv = invoices.data.find((i) => i.id === id);
  if (!inv) return <section className="page"><Link to="/sales/invoices" className="back-link">{tr('← Customer invoices')}</Link><p className="muted">{tr('This invoice was not found.')}</p></section>;

  const order = orders.data.find((o) => o.id === inv.orderId);
  const customer = customers.data.find((c) => c.id === inv.customerId)?.name ?? tr('Unknown customer');
  const itemOf = (orderLineId: string) => {
    const itemId = order?.lines.find((l) => l.id === orderLineId)?.itemId;
    const i = items.data?.find((v) => v.id === itemId);
    return i ? `${i.sku} · ${i.name}` : '—';
  };
  const canManage = session.permissions.includes('sales.invoices.manage');

  async function voidIt() {
    setBusy(true); setMessage(null);
    try { await api(`/v1/sales/invoices/${id}/void`, { method: 'POST' }); setMessage({ ok: true, text: tr('Invoice voided. Its quantity can be invoiced again.') }); invoices.reload(); }
    catch (e) { setMessage({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <section className="page">
      <Link to="/sales/invoices" className="back-link">{tr('← Customer invoices')}</Link>
      <div className="page-head">
        <h1 className="mono">{inv.number}</h1>
        <Pill status={inv.status === 'void' ? 'cancelled' : 'received'} label={inv.status === 'void' ? tr('Void') : tr('Issued')} />
      </div>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}
      <dl className="facts">
        <div><dt>{tr('Customer')}</dt><dd>{customer}</dd></div>
        <div><dt>{tr('Sales order')}</dt><dd><Link to={`/sales/orders/${inv.orderId}`}><code>{order?.number ?? '—'}</code></Link></dd></div>
        <div><dt>{tr('Invoice date')}</dt><dd>{inv.invoiceDate}</dd></div>
        <div><dt>{tr('Created')}</dt><dd>{formatDateTime(inv.createdAt, session.org)}</dd></div>
        <div><dt>{tr('Total')}</dt><dd className="amount">{money(inv.totalMinor, inv.currency)}</dd></div>
      </dl>

      <div className="table-wrap"><table>
        <thead><tr><th>{tr('Item')}</th><th className="right">{tr('Quantity')}</th><th className="right">{tr('Unit price')}</th><th className="right">{tr('Line total')}</th></tr></thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.orderLineId}><td>{itemOf(l.orderLineId)}</td><td className="right">{l.qty}</td><td className="right">{money(l.unitPriceMinor, inv.currency)}</td><td className="right">{money(Math.round(l.qty * l.unitPriceMinor), inv.currency)}</td></tr>
          ))}
          <tr><td colSpan={3} className="right"><strong>{tr('Total')}</strong></td><td className="right"><strong>{money(inv.totalMinor, inv.currency)}</strong></td></tr>
        </tbody>
      </table></div>

      {inv.status === 'void' && <p className="muted">{tr('This invoice was voided. Its quantity can be invoiced again.')}</p>}
      {canManage && inv.status === 'issued' && <div className="form-actions" style={{ marginBlockStart: '1rem' }}><Button variant="outline" disabled={busy} onClick={voidIt}>{tr('Void invoice')}</Button></div>}
      {inv.status === 'issued' && <PaymentsAgainst field="customerInvoiceId" id={inv.id} totalMinor={inv.totalMinor} currency={inv.currency} />}
      <RecordHistory key={inv.id} id={inv.id} />
    </section>
  );
}

import { useMemo, useState } from 'react';
import { Loading } from '../../components/Loading';
import { billingFor, formatMoney, type BillingFlag } from '@erp/shared';
import { api } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Button } from '../../components/ui/button';
import { ClickRow } from '../../components/ClickRow';
import { ConfirmButton, FormToggle } from '../../components/FormToggle';
import { RecordHistory } from '../../components/RecordHistory';
import { Link, useParam } from '../../lib/router';
import { PaymentsAgainst } from '../finance/FinanceRecords';
import { PaymentLinks } from '../finance/PaymentLinks';
import { Pill } from '../trade/common';

import { tr, trf } from '../../lib/i18n';
// Customer invoices: bill a delivered sales order, line by line, and see ordered / delivered / invoiced with a flag for
// whatever does not match. The price always comes from the order line; the database refuses over-invoicing.

type OrderLine = { id: string; itemId: string; qty: number; unitPriceMinor: number };
type Order = { id: string; number: string; customerId: string; status: string; currency: string; requestStatus: string | null; lines: OrderLine[] };
type Invoice = { id: string; number: string; orderId: string; customerId: string; invoiceDate: string; dueDate?: string; currency: string; status: 'issued' | 'void'; totalMinor: number; createdAt: string; lines: { orderLineId: string; qty: number; unitPriceMinor: number }[] };
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
  // "Create invoice" on a delivered order opens this page with ?order=… already chosen (UX audit: the order page had no way here).
  const preset = new URLSearchParams(window.location.search).get('order') ?? '';
  const [orderId, setOrderId] = useState(preset);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [formOpen, setFormOpen] = useState(Boolean(preset));

  const invoicedByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of invoices.data ?? []) if (i.status === 'issued') for (const l of i.lines) m.set(l.orderLineId, (m.get(l.orderLineId) ?? 0) + l.qty);
    return m;
  }, [invoices.data]);

  if (!orders.data || !invoices.data || !customers.data || !items.data) return <section className="page"><Loading error={orders.error ?? invoices.error} /></section>;

  const customer = (id: string) => customers.data?.find((c) => c.id === id)?.name ?? 'Unknown customer';
  const item = (id: string) => { const i = items.data?.find((v) => v.id === id); return i ? `${i.sku} · ${i.name}` : id; };
  const rows = orders.data.filter((o) => o.status !== 'cancelled').map((o) => ({ o, billing: billingFor(o.lines.map((l) => ({ orderLineId: l.id, itemId: l.itemId, qty: l.qty })), o.requestStatus, invoicedByLine) }));
  const open = rows.filter((r) => r.billing.some((b) => b.flag === 'under_invoiced'));
  const chosen = rows.find((r) => r.o.id === orderId);
  const canManage = session.permissions.includes('sales.invoices.manage');
  // Each line starts with what is still to invoice (UX audit: every quantity started empty though the remainder is known).
  const left = (b: { delivered: number; invoiced: number }) => Math.max(0, b.delivered - b.invoiced);
  const qtyFor = (b: { orderLineId: string; delivered: number; invoiced: number }) => {
    const typed = qty[b.orderLineId];
    return typed === undefined ? left(b) : Number(typed) || 0;
  };

  async function create() {
    if (!chosen) return;
    setBusy(true); setMessage(null);
    try {
      const lines = chosen.billing.filter((b) => qtyFor(b) > 0).map((b) => ({ orderLineId: b.orderLineId, qty: qtyFor(b) }));
      const made = await api<{ number: string }>(`/v1/sales/orders/${chosen.o.id}/invoices`, { method: 'POST', body: JSON.stringify({ invoiceDate: date, lines }) });
      setMessage({ ok: true, text: trf('Invoice {number} created.', { number: made.number }) }); setOrderId(''); setQty({});
      invoices.reload();
    } catch (e) { setMessage({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  // Billing status per order, worst line first. The table shows only orders that need something (not fully invoiced, or invoiced more
  // than delivered) unless the person asks for all: with hundreds of finished orders the screen was a wall of "Fully invoiced".
  const billingRows = rows.map(({ o, billing }) => {
    const sum = (k: 'ordered' | 'delivered' | 'invoiced') => billing.reduce((n, b) => n + b[k], 0);
    const worst = billing.find((b) => b.flag === 'over_invoiced') ?? billing.find((b) => b.flag === 'under_invoiced') ?? billing.find((b) => b.flag === 'not_delivered') ?? billing[0];
    return { o, sum, flag: worst?.flag ?? 'not_delivered' as BillingFlag };
  });
  // Orders not delivered yet cannot be invoiced, so they are not "orders to invoice" (UX audit); "Show all" still lists them.
  const attention = billingRows.filter((r) => r.flag !== 'ok' && r.flag !== 'not_delivered');
  const shownBilling = showAll ? billingRows : attention;

  return (
    <section className="page wide">
      <h1>{tr('Sales invoices')}</h1>
      <p className="muted">{tr('Invoice delivered sales orders. A wrong invoice is voided, not edited.')}</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      {canManage && (
        <FormToggle label={tr('Create an invoice')} open={formOpen} onOpenChange={setFormOpen}>
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
              <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Delivered')}</th><th scope="col" className="right">{tr('Already invoiced')}</th><th scope="col">{tr('Quantity to invoice')}</th></tr></thead><tbody>
                {chosen.billing.map((b) => (
                  <tr key={b.orderLineId}><td>{item(b.itemId)}</td><td className="right">{b.delivered}</td><td className="right">{b.invoiced}</td>
                    <td><input type="number" min="0" max={left(b)} step="0.001" aria-label={trf('Quantity to invoice for {item}', { item: item(b.itemId) })} value={qty[b.orderLineId] ?? String(left(b))} onChange={(e) => setQty((q) => ({ ...q, [b.orderLineId]: e.target.value }))} /></td></tr>
                ))}
              </tbody></table></div>
              {!chosen.billing.some((b) => qtyFor(b) > 0) ? <p className="muted small">{tr('Nothing is left to invoice on this order.')}</p> : null}
              <Button disabled={busy || !chosen.billing.some((b) => qtyFor(b) > 0)} onClick={create}>{busy ? tr('Creating…') : tr('Create invoice')}</Button>
            </>
          )}
        </FormToggle>
      )}

      <h2 className="related">{tr('Invoices')}</h2>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Invoice')}</th><th scope="col">{tr('Customer')}</th><th scope="col">{tr('Order')}</th><th scope="col">{tr('Created')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col">{tr('Status')}</th></tr></thead><tbody>
        {invoices.data.map((i) => (
          <ClickRow key={i.id} to={`/sales/invoices/${i.id}`}><td><Link to={`/sales/invoices/${i.id}`}><code>{i.number}</code></Link></td><td>{customer(i.customerId)}</td><td><Link to={`/sales/orders/${i.orderId}`}><code>{orders.data?.find((o) => o.id === i.orderId)?.number ?? '—'}</code></Link></td><td className="nowrap">{formatDateTime(i.createdAt, session.org)}</td><td className="right">{money(i.totalMinor, i.currency)}</td>
            <td><Pill status={i.status === 'void' ? 'cancelled' : 'received'} label={i.status === 'void' ? tr('Void') : tr('Issued')} /></td></ClickRow>
        ))}
        {!invoices.data.length && <tr><td colSpan={6} className="muted empty">{tr('No invoices yet.')}</td></tr>}
      </tbody></table></div>

      <div className="section-head">
        <h2 className="related">{showAll ? tr('Billing status') : tr('Orders to invoice')} <span className="muted small">({shownBilling.length})</span></h2>
        {billingRows.length > attention.length && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>{showAll ? tr('Only orders that need attention') : trf('Show all {count} orders', { count: billingRows.length })}</Button>
        )}
      </div>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Order')}</th><th scope="col">{tr('Customer')}</th><th scope="col" className="right">{tr('Ordered')}</th><th scope="col" className="right">{tr('Delivered')}</th><th scope="col" className="right">{tr('Invoiced')}</th><th scope="col">{tr('Status')}</th></tr></thead><tbody>
        {shownBilling.map(({ o, sum, flag }) => {
          const f = FLAG[flag];
          return <ClickRow key={o.id} to={`/sales/orders/${o.id}`}><td><Link to={`/sales/orders/${o.id}`}><code>{o.number}</code></Link></td><td>{customer(o.customerId)}</td><td className="right">{sum('ordered')}</td><td className="right">{sum('delivered')}</td><td className="right">{sum('invoiced')}</td><td><Pill status={f.pill} label={tr(f.label)} /></td></ClickRow>;
        })}
        {!shownBilling.length && <tr><td colSpan={6} className="muted empty">{rows.length ? tr('Every order is fully invoiced.') : tr('No sales orders yet.')}</td></tr>}
      </tbody></table></div>
    </section>
  );
}

/** One customer invoice: who, which order, its lines and total, the payments against it, and its history. */
export function CustomerInvoicePage() {
  const id = useParam('id');
  const session = useSession();
  // The invoice and its order by id (the lists hold the newest 200 only, so an older invoice would not be found in them).
  const record = useLoad(async () => {
    const invoice = await api<Invoice>(`/v1/sales/invoices/${id}`);
    const order = await api<Order>(`/v1/sales/orders/${invoice.orderId}`).catch(() => null);
    return { invoice, order };
  });
  const customers = useLoad(() => api<Customer[]>('/v1/sales/customers'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const invoices = { reload: record.reload };
  const [payKey, setPayKey] = useState(0);

  if (record.error) return <section className="page"><Link to="/sales/invoices" className="back-link">{tr('← Sales invoices')}</Link><Loading error={record.error} /></section>;
  if (!record.data || !customers.data || !items.data) return <section className="page"><Loading /></section>;
  const inv = record.data.invoice;
  const order = record.data.order;
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
      <Link to="/sales/invoices" className="back-link">{tr('← Sales invoices')}</Link>
      <div className="page-head">
        <h1 className="mono">{inv.number}</h1>
        <Pill status={inv.status === 'void' ? 'cancelled' : 'received'} label={inv.status === 'void' ? tr('Void') : tr('Issued')} />
      </div>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}
      <dl className="facts">
        <div><dt>{tr('Customer')}</dt><dd>{customer}</dd></div>
        <div><dt>{tr('Sales order')}</dt><dd><Link to={`/sales/orders/${inv.orderId}`}><code>{order?.number ?? '—'}</code></Link></dd></div>
        <div><dt>{tr('Invoice date')}</dt><dd>{formatDay(inv.invoiceDate, session.org)}</dd></div>
        {inv.dueDate ? <div><dt>{tr('Due date')}</dt><dd>{formatDay(inv.dueDate, session.org)}</dd></div> : null}
        <div><dt>{tr('Created')}</dt><dd>{formatDateTime(inv.createdAt, session.org)}</dd></div>
        <div><dt>{tr('Total')}</dt><dd className="amount">{money(inv.totalMinor, inv.currency)}</dd></div>
      </dl>

      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Quantity')}</th><th scope="col" className="right">{tr('Unit price')}</th><th scope="col" className="right">{tr('Line total')}</th></tr></thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.orderLineId}><td>{itemOf(l.orderLineId)}</td><td className="right">{l.qty}</td><td className="right">{money(l.unitPriceMinor, inv.currency)}</td><td className="right">{money(Math.round(l.qty * l.unitPriceMinor), inv.currency)}</td></tr>
          ))}
          <tr><td colSpan={3} className="right"><strong>{tr('Total')}</strong></td><td className="right"><strong>{money(inv.totalMinor, inv.currency)}</strong></td></tr>
        </tbody>
      </table></div>

      {inv.status === 'void' && <p className="muted">{tr('This invoice was voided. Its quantity can be invoiced again.')}</p>}
      {canManage && inv.status === 'issued' && <div className="form-actions" style={{ marginBlockStart: '1rem' }}><ConfirmButton label={tr('Void invoice')} confirmLabel={tr('Yes, void it')} question={tr('Void this invoice? It can not be undone; its quantity can then be invoiced again.')} disabled={busy} onConfirm={voidIt} /></div>}
      {inv.status === 'issued' && <PaymentsAgainst key={payKey} field="customerInvoiceId" id={inv.id} totalMinor={inv.totalMinor} currency={inv.currency} />}
      {inv.status === 'issued' && <PaymentLinks invoiceId={inv.id} onPaid={() => setPayKey((k) => k + 1)} />}
      <RecordHistory key={inv.id} id={inv.id} />
    </section>
  );
}

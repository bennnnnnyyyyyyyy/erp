import { useMemo, useState } from 'react';
import { Attachments } from '../../components/Attachments';
import { Loading } from '../../components/Loading';
import { billingFor, formatMoney, type BillingFlag, type VatSettings } from '@erp/shared';
import { api } from '../../lib/api';
import { formatDateTime, formatDay } from '../../lib/format';
import { failed, useLoad } from '../../lib/useLoad';
import { usePaged } from '../../lib/usePaged';
import { useDateGuard } from '../../lib/dateGuard';
import { ListView, type Column } from '../../components/views/ListView';
import { useSession } from '../../session';
import { todayIn } from '../../lib/dates';
import { Button, buttonVariants } from '../../components/ui/button';
import { ClickRow } from '../../components/ClickRow';
import { DateInput } from '../../components/DateInput';
import { ConfirmButton, FormToggle } from '../../components/FormToggle';
import { RecordHistory } from '../../components/RecordHistory';
import { BackLink, Link, useParam } from '../../lib/router';
import { PaymentsAgainst } from '../finance/FinanceRecords';
import { PaymentLinks } from '../finance/PaymentLinks';
import { Pill } from '../trade/common';
import { InvoiceNotes } from './InvoiceNotes';
import { DraftInvoices, type InvoiceDraft } from './print/DraftInvoices';
import { netInvoiceMinor } from './noteMath';
import { ScanDocQr } from './ScanDocQr';

import { TheirCodeCell, TheirCodeHeader, codesFor, usePartyCodes } from '../inventory/PartyCodes';
import { tr, trf } from '../../lib/i18n';
import { unitText } from '../../lib/lineUnits';
// Customer invoices: bill a delivered sales order, line by line, and see ordered / delivered / invoiced with a flag for
// whatever does not match. The price always comes from the order line; the database refuses over-invoicing.

type OrderLine = { id: string; itemId: string; qty: number; unitPriceMinor: number; unit?: string | null; unitFactor?: number | null };
type Order = { id: string; number: string; customerId: string; status: string; currency: string; requestStatus: string | null; lines: OrderLine[] };
// netMinor / taxMinor / grossMinor: stored by the database (sql/086); totalMinor is the gross. Optional while an older API answers.
type InvoiceLine = { id?: string; orderLineId: string; qty: number; unitPriceMinor: number; taxRate?: number; netMinor?: number; taxMinor?: number; grossMinor?: number; priceIncludesVat?: boolean };
type Invoice = { id: string; number: string; orderId: string; customerId: string; invoiceDate: string; dueDate?: string; currency: string; status: 'issued' | 'void'; totalMinor: number; netMinor?: number; taxMinor?: number; grossMinor?: number; createdAt: string; creditedMinor?: number; debitedMinor?: number; lines: InvoiceLine[] };
type Customer = { id: string; name: string };

type Item = { id: string; sku: string; name: string; uom?: string };

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
  // The list people read: paged and searched on the server (number or customer; Ben, 25 Nov 2026). `invoices` above stays the
  // source of what each order has invoiced.
  const [search, setSearch] = useState('');
  const list = usePaged<Invoice>(`/v1/sales/invoices${search ? `?q=${encodeURIComponent(search)}` : ''}`, 200);
  // Save waits while the invoice date box holds a bad date (Ben, 25 Nov 2026).
  const dates = useDateGuard();
  const customers = useLoad(() => api<Customer[]>('/v1/sales/customers'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));
  // VAT (sql/086): when the company is registered each line may name its rate; empty means the item's, else the company default.
  // An older API without the route simply means no VAT choice on screen.
  const vat = useLoad(() => api<VatSettings>('/v1/core/org/vat').catch(() => null));
  const [lineRate, setLineRate] = useState<Record<string, string>>({});
  // "Create invoice" on a delivered order opens this page with ?order=… already chosen (UX audit: the order page had no way here).
  const preset = new URLSearchParams(window.location.search).get('order') ?? '';
  const [orderId, setOrderId] = useState(preset);
  const [date, setDate] = useState(() => todayIn());   // company time zone (decision D11)
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [formOpen, setFormOpen] = useState(Boolean(preset));
  // Invoice printing (sql/103): "Create" saves a draft (no number, nothing posted); Issue gives the number. Editing reopens this form.
  const [editing, setEditing] = useState<string | null>(null);
  const [draftsKey, setDraftsKey] = useState(0);

  const invoicedByLine = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of invoices.data ?? []) if (i.status === 'issued') for (const l of i.lines) m.set(l.orderLineId, (m.get(l.orderLineId) ?? 0) + l.qty);
    return m;
  }, [invoices.data]);

  if (!orders.data || !invoices.data || !customers.data || !items.data) return <section className="page"><Loading {...failed(orders, invoices, customers, items)} /></section>;

  const customer = (id: string) => customers.data?.find((c) => c.id === id)?.name ?? 'Unknown customer';
  const item = (id: string) => { const i = items.data?.find((v) => v.id === id); return i ? `${i.sku} · ${i.name}` : id; };
  const rows = orders.data.filter((o) => o.status !== 'cancelled').map((o) => ({ o, billing: billingFor(o.lines.map((l) => ({ orderLineId: l.id, itemId: l.itemId, qty: l.qty })), o.requestStatus, invoicedByLine) }));
  const open = rows.filter((r) => r.billing.some((b) => b.flag === 'under_invoiced'));
  const waiting = rows.filter((r) => r.billing.length > 0 && r.billing.every((b) => b.flag === 'not_delivered')).length;
  const chosen = rows.find((r) => r.o.id === orderId);
  const canManage = session.permissions.includes('sales.invoices.manage');
  const vatOn = vat.data?.vatRegistered === true;
  const defaultRate = vat.data?.rates.find((r) => r.id === vat.data?.defaultVatRateId);
  // Each line starts with what is still to invoice (UX audit: every quantity started empty though the remainder is known).
  const left = (b: { delivered: number; invoiced: number }) => Math.max(0, b.delivered - b.invoiced);
  const orderNumber = (id: string) => orders.data?.find((o) => o.id === id)?.number ?? '—';
  const invoiceColumns: Column<Invoice>[] = [
    { key: 'number', label: tr('Invoice'), value: (i) => i.number, render: (i) => <Link to={`/sales/invoices/${i.id}`}><code>{i.number}</code></Link> },
    { key: 'customer', label: tr('Customer'), value: (i) => customer(i.customerId) },
    { key: 'order', label: tr('Order'), value: (i) => orderNumber(i.orderId), render: (i) => <Link to={`/sales/orders/${i.orderId}`}><code>{orderNumber(i.orderId)}</code></Link> },
    { key: 'created', label: tr('Created'), value: (i) => i.createdAt, render: (i) => <span className="nowrap">{formatDateTime(i.createdAt, session.org)}</span> },
    { key: 'amount', label: tr('Amount'), value: (i) => i.totalMinor / 100, render: (i) => money(i.totalMinor, i.currency), align: 'right' },
    {
      key: 'status',
      label: tr('Status'),
      value: (i) => (i.status === 'void' ? tr('Void') : tr('Issued')),
      render: (i) => <Pill status={i.status === 'void' ? 'cancelled' : 'received'} label={i.status === 'void' ? tr('Void') : tr('Issued')} />,
    },
  ];
  const qtyFor = (b: { orderLineId: string; delivered: number; invoiced: number }) => {
    const typed = qty[b.orderLineId];
    return typed === undefined ? left(b) : Number(typed) || 0;
  };

  async function create() {
    if (!chosen) return;
    setBusy(true); setMessage(null);
    try {
      const lines = chosen.billing.filter((b) => qtyFor(b) > 0).map((b) => {
        const taxRateId = vatOn ? lineRate[b.orderLineId] : undefined;
        return { orderLineId: b.orderLineId, qty: qtyFor(b), ...(taxRateId ? { taxRateId } : {}) };
      });
      await api<{ id: string }>('/v1/sales/invoice-drafts', { method: 'POST', body: JSON.stringify({ draftId: editing, orderId: chosen.o.id, invoiceDate: date, lines }) });
      setMessage({ ok: true, text: tr('Draft saved. Check it, then issue it: it gets its number then and can no longer change.') }); setOrderId(''); setQty({}); setLineRate({}); setEditing(null);
      setDraftsKey((k) => k + 1);
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
      <p className="muted">{tr('Invoice delivered sales orders. A new invoice starts as a draft. Once issued it never changes: correct it with a credit or debit note.')}</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      {canManage && (
        <FormToggle label={tr('Create an invoice')} open={formOpen} onOpenChange={setFormOpen}>
          <div className="form-row">
            {/* Ben, 25 Nov: "choose an order doesn't show anything". Only delivered orders with something left to bill can be invoiced;
                with none, say so and point to the orders still waiting for delivery instead of an empty list. */}
            {open.length === 0 && !editing ? (
              <div className="notice" role="status">
                <p style={{ marginBlock: 0 }}>{tr('No delivered orders to invoice yet. An order can be invoiced once its goods have left the warehouse.')}</p>
                {waiting > 0 ? (
                  <Link to="/sales/orders">{trf(waiting === 1 ? 'See the {n} order waiting for delivery' : 'See the {n} orders waiting for delivery', { n: waiting })}</Link>
                ) : (
                  <Link to="/sales/orders/new">{tr('New sales order')}</Link>
                )}
              </div>
            ) : (
              <label>{tr('Delivered sales order')}
                <select value={orderId} disabled={!!editing} onChange={(e) => { setOrderId(e.target.value); setQty({}); }}>
                  <option value="">{tr('Choose an order…')}</option>
                  {open.map((r) => <option key={r.o.id} value={r.o.id}>{r.o.number} · {customer(r.o.customerId)}</option>)}
                </select>
              </label>
            )}
            <label>{tr('Invoice date')}<DateInput value={date} onChange={(e) => setDate(e.target.value)} max={todayIn()} required onBad={dates.watch('date')} /></label>
          </div>
          {chosen && (
            <>
              <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Delivered')}</th><th scope="col" className="right">{tr('Already invoiced')}</th><th scope="col">{tr('Quantity to invoice')}</th>{vatOn ? <th scope="col">{tr('VAT')}</th> : null}</tr></thead><tbody>
                {chosen.billing.map((b) => (
                  <tr key={b.orderLineId}><td>{item(b.itemId)}</td><td className="right">{b.delivered}</td><td className="right">{b.invoiced}</td>
                    <td><input type="number" min="0" max={left(b)} step="0.001" aria-label={trf('Quantity to invoice for {item}', { item: item(b.itemId) })} value={qty[b.orderLineId] ?? String(left(b))} onChange={(e) => setQty((q) => ({ ...q, [b.orderLineId]: e.target.value }))} /></td>
                    {vatOn ? (
                      <td>
                        <select aria-label={trf('VAT for {item}', { item: item(b.itemId) })} value={lineRate[b.orderLineId] ?? ''} onChange={(e) => setLineRate((r) => ({ ...r, [b.orderLineId]: e.target.value }))}>
                          <option value="">{defaultRate ? trf('Item or company default ({label})', { label: defaultRate.label }) : tr('Item or company default')}</option>
                          {vat.data?.rates.map((r) => <option key={r.id} value={r.id}>{r.label} ({r.rate}%)</option>)}
                          <option value="exempt">{tr('No VAT (exempt)')}</option>
                        </select>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody></table></div>
              {vatOn ? <p className="muted small">{vat.data?.pricesIncludeVat ? tr('Prices include VAT: each line is split into the amount before VAT and the VAT when the invoice is created, and never changes afterwards.') : tr('Prices are before VAT. The VAT is worked out on each line when the invoice is created and never changes afterwards.')}</p> : null}
              {!chosen.billing.some((b) => qtyFor(b) > 0) ? <p className="muted small">{tr('Nothing is left to invoice on this order.')}</p> : null}
              <Button disabled={busy || dates.blocked || !chosen.billing.some((b) => qtyFor(b) > 0)} onClick={create}>{busy ? tr('Saving…') : editing ? tr('Save draft') : tr('Create draft invoice')}</Button>
            </>
          )}
        </FormToggle>
      )}

      <DraftInvoices key={draftsKey} canManage={canManage} customer={customer} orderNumber={(oid) => orders.data?.find((o) => o.id === oid)?.number ?? '—'}
        onEdit={(d: InvoiceDraft) => { setEditing(d.id); setOrderId(d.orderId); setDate(d.invoiceDate); setQty(Object.fromEntries(d.lines.map((l) => [l.orderLineId, String(l.qty)]))); setLineRate(Object.fromEntries(d.lines.filter((l) => l.taxRateId).map((l) => [l.orderLineId, l.taxRateId ?? '']))); setFormOpen(true); window.scrollTo({ top: 0 }); }}
        onIssued={(number) => { setMessage({ ok: true, text: trf('Invoice {number} issued.', { number }) }); invoices.reload(); list.reload(); }} />

      <div className="section-head">
        <h2 className="related">{tr('Invoices')}</h2>
        <ScanDocQr />
      </div>
      {/* Paged and searched on the server (Ben, 25 Nov 2026): the number or the customer's name finds older invoices too. */}
      {list.data ? <ListView
        rows={list.data}
        columns={invoiceColumns}
        rowKey={(i) => i.id}
        title={tr('Sales invoices')}
        empty={tr('No invoices yet.')}
        rowHref={(i) => `/sales/invoices/${i.id}`}
        more={{ hasMore: list.hasMore, loading: list.loading, onMore: list.more, error: list.error }}
        onServerSearch={setSearch}
      /> : <Loading {...failed(list)} />}

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
  // The customer's own codes for these items (sql/099), as a "Their code" column when a line has one.
  const lineItem = (orderLineId: string) => record.data?.order?.lines.find((l) => l.id === orderLineId)?.itemId;
  const theirCodes = codesFor(usePartyCodes('customer', record.data?.invoice.customerId), (record.data?.invoice.lines ?? []).map((l) => lineItem(l.orderLineId)));

  if (record.error) return <section className="page"><BackLink to="/sales/invoices" label={tr('← Sales invoices')} backLabel={tr('← Back')} /><Loading error={record.error} /></section>;
  if (!record.data || !customers.data || !items.data) return <section className="page"><Loading {...failed(customers, items)} /></section>;
  const inv = record.data.invoice;
  const order = record.data.order;
  const customer = customers.data.find((c) => c.id === inv.customerId)?.name ?? tr('Unknown customer');
  const itemOf = (orderLineId: string) => {
    const itemId = order?.lines.find((l) => l.id === orderLineId)?.itemId;
    const i = items.data?.find((v) => v.id === itemId);
    return i ? `${i.sku} · ${i.name}` : '—';
  };
  // Slice D: the quantity as the order line was typed ("3 box (36 piece)"); the invoice itself stays in the base unit.
  const qtyText = (l: InvoiceLine) => {
    const ol = order?.lines.find((x) => x.id === l.orderLineId);
    const uom = items.data?.find((v) => v.id === ol?.itemId)?.uom ?? '';
    return ol?.unit ? unitText(l.qty, uom, ol.unit, ol.unitFactor, tr) : String(l.qty);
  };
  const canManage = session.permissions.includes('sales.invoices.manage');
  // Approved credit and debit notes change what is owed (the invoice itself is never edited).
  const credited = inv.creditedMinor ?? 0;
  const debited = inv.debitedMinor ?? 0;
  const net = netInvoiceMinor(inv.totalMinor, credited, debited);
  // VAT (sql/086): shown only when the invoice carries any, so invoices without VAT look as they always did.
  const lineNet = (l: InvoiceLine) => l.netMinor ?? Math.round(l.qty * l.unitPriceMinor);
  const hasVat = (inv.taxMinor ?? 0) > 0 || inv.lines.some((l) => (l.taxRate ?? 0) > 0);
  const cols = (hasVat ? 6 : 4) + (theirCodes.size ? 1 : 0);

  async function voidIt() {
    setBusy(true); setMessage(null);
    try { await api(`/v1/sales/invoices/${id}/void`, { method: 'POST' }); setMessage({ ok: true, text: tr('Invoice voided. Its quantity can be invoiced again.') }); invoices.reload(); }
    catch (e) { setMessage({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <section className="page">
      <BackLink to="/sales/invoices" label={tr('← Sales invoices')} backLabel={tr('← Back')} />
      <div className="page-head">
        <h1 className="mono">{inv.number}</h1>
        <Pill status={inv.status === 'void' ? 'cancelled' : 'received'} label={inv.status === 'void' ? tr('Void') : tr('Issued')} />
        <Link to={`/sales/print/invoice/${inv.id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>{tr('Print or send')}</Link>
      </div>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}
      <dl className="facts">
        <div><dt>{tr('Customer')}</dt><dd>{customer}</dd></div>
        <div><dt>{tr('Sales order')}</dt><dd><Link to={`/sales/orders/${inv.orderId}`}><code>{order?.number ?? '—'}</code></Link></dd></div>
        <div><dt>{tr('Invoice date')}</dt><dd>{formatDay(inv.invoiceDate, session.org)}</dd></div>
        {inv.dueDate ? <div><dt>{tr('Due date')}</dt><dd>{formatDay(inv.dueDate, session.org)}</dd></div> : null}
        <div><dt>{tr('Created')}</dt><dd>{formatDateTime(inv.createdAt, session.org)}</dd></div>
        {hasVat ? <div><dt>{tr('Before VAT')}</dt><dd className="amount">{money(inv.netMinor ?? 0, inv.currency)}</dd></div> : null}
        {hasVat ? <div><dt>{tr('VAT')}</dt><dd className="amount">{money(inv.taxMinor ?? 0, inv.currency)}</dd></div> : null}
        <div><dt>{hasVat ? tr('Total with VAT') : tr('Total')}</dt><dd className="amount">{money(inv.totalMinor, inv.currency)}</dd></div>
        {credited > 0 ? <div><dt>{tr('Credited')}</dt><dd className="amount">−{money(credited, inv.currency)}</dd></div> : null}
        {debited > 0 ? <div><dt>{tr('Debited')}</dt><dd className="amount">+{money(debited, inv.currency)}</dd></div> : null}
        {credited > 0 || debited > 0 ? <div><dt>{tr('Amount owed after notes')}</dt><dd className="amount">{money(net, inv.currency)}</dd></div> : null}
      </dl>

      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{tr('Item')}</th><TheirCodeHeader codes={theirCodes} /><th scope="col" className="right">{tr('Quantity')}</th><th scope="col" className="right">{inv.lines.some((l) => l.priceIncludesVat) ? tr('Unit price (with VAT)') : tr('Unit price')}</th><th scope="col" className="right">{hasVat ? tr('Before VAT') : tr('Line total')}</th>
          {hasVat ? <><th scope="col" className="right">{tr('VAT rate')}</th><th scope="col" className="right">{tr('VAT')}</th></> : null}</tr></thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id ?? l.orderLineId}><td>{itemOf(l.orderLineId)}</td><TheirCodeCell codes={theirCodes} itemId={lineItem(l.orderLineId)} /><td className="right">{qtyText(l)}</td><td className="right">{money(l.unitPriceMinor, inv.currency)}</td><td className="right">{money(lineNet(l), inv.currency)}</td>
              {hasVat ? <><td className="right">{(l.taxRate ?? 0) > 0 ? `${l.taxRate}%` : tr('None')}</td><td className="right">{money(l.taxMinor ?? 0, inv.currency)}</td></> : null}</tr>
          ))}
          {hasVat ? <tr><td colSpan={cols - 1} className="right">{tr('Before VAT')}</td><td className="right">{money(inv.netMinor ?? 0, inv.currency)}</td></tr> : null}
          {hasVat ? <tr><td colSpan={cols - 1} className="right">{tr('VAT')}</td><td className="right">{money(inv.taxMinor ?? 0, inv.currency)}</td></tr> : null}
          <tr><td colSpan={cols - 1} className="right"><strong>{hasVat ? tr('Total with VAT') : tr('Total')}</strong></td><td className="right"><strong>{money(inv.totalMinor, inv.currency)}</strong></td></tr>
        </tbody>
      </table></div>

      {inv.status === 'void' && <p className="muted">{tr('This invoice was voided. Its quantity can be invoiced again.')}</p>}
      {canManage && inv.status === 'issued' && <div className="form-actions" style={{ marginBlockStart: '1rem' }}><ConfirmButton label={tr('Void invoice')} confirmLabel={tr('Yes, void it')} question={tr('Void this invoice only if it should never have been issued (for example, the wrong customer). To change amounts or quantities, make a credit or debit note instead. Voiding cannot be undone; the quantity can then be invoiced again, and its customer link stops working.')} disabled={busy} onConfirm={voidIt} /></div>}
      <InvoiceNotes invoice={inv} itemOf={itemOf} onChanged={invoices.reload} />
      {inv.status === 'issued' && <PaymentsAgainst key={payKey} field="customerInvoiceId" id={inv.id} totalMinor={net} currency={inv.currency} />}
      {inv.status === 'issued' && <PaymentLinks invoiceId={inv.id} onPaid={() => setPayKey((k) => k + 1)} />}
      <Attachments entityType="sales_invoice" entityId={inv.id} />
      <RecordHistory key={inv.id} id={inv.id} />
    </section>
  );
}

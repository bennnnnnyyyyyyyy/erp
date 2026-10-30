import { useMemo, useState } from 'react';
import { billingFor, formatMoney, type BillingFlag } from '@erp/shared';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';

// Customer invoices: bill a delivered sales order, line by line, and see ordered / delivered / invoiced with a flag for
// whatever does not match. The price always comes from the order line; the database refuses over-invoicing.

type OrderLine = { id: string; itemId: string; qty: number; unitPriceMinor: number };
type Order = { id: string; number: string; customerId: string; status: string; currency: string; requestStatus: string | null; lines: OrderLine[] };
type Invoice = { id: string; number: string; orderId: string; customerId: string; invoiceDate: string; currency: string; status: 'issued' | 'void'; totalMinor: number; createdAt: string; lines: { orderLineId: string; qty: number }[] };
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

  if (!orders.data || !invoices.data || !customers.data || !items.data) return <section className="page"><p className="muted">{orders.error ?? invoices.error ?? 'Loading…'}</p></section>;

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
      setMessage({ ok: true, text: `Invoice ${made.number} created.` }); setOrderId(''); setQty({});
      invoices.reload();
    } catch (e) { setMessage({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function voidInvoice(id: string) {
    setBusy(true); setMessage(null);
    try { await api(`/v1/sales/invoices/${id}/void`, { method: 'POST' }); setMessage({ ok: true, text: 'Invoice voided. Its quantity can be invoiced again.' }); invoices.reload(); }
    catch (e) { setMessage({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <section className="page wide">
      <h1>Customer invoices</h1>
      <p className="muted">Bill delivered sales orders. An order can only be invoiced once its stock has been issued, and never for more than was delivered. A wrong invoice is voided, not edited.</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      {canManage && (
        <div className="form-card stack">
          <h2>Create an invoice</h2>
          <div className="form-row">
            <label>Delivered sales order
              <select value={orderId} onChange={(e) => { setOrderId(e.target.value); setQty({}); }}>
                <option value="">Choose an order…</option>
                {open.map((r) => <option key={r.o.id} value={r.o.id}>{r.o.number} · {customer(r.o.customerId)}</option>)}
              </select>
            </label>
            <label>Invoice date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          </div>
          {chosen && (
            <>
              <div className="table-wrap"><table><thead><tr><th>Item</th><th className="right">Delivered</th><th className="right">Already invoiced</th><th>Invoice now</th></tr></thead><tbody>
                {chosen.billing.map((b) => (
                  <tr key={b.orderLineId}><td>{item(b.itemId)}</td><td className="right">{b.delivered}</td><td className="right">{b.invoiced}</td>
                    <td><input type="number" min="0" max={b.delivered - b.invoiced} step="0.001" aria-label={`Quantity to invoice for ${item(b.itemId)}`} value={qty[b.orderLineId] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [b.orderLineId]: e.target.value }))} /></td></tr>
                ))}
              </tbody></table></div>
              <button disabled={busy || !Object.values(qty).some((v) => Number(v) > 0)} onClick={create}>{busy ? 'Creating…' : 'Create invoice'}</button>
            </>
          )}
        </div>
      )}

      <h2 className="related">Ordered, delivered and invoiced</h2>
      <div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th className="right">Ordered</th><th className="right">Delivered</th><th className="right">Invoiced</th><th>Status</th></tr></thead><tbody>
        {rows.map(({ o, billing }) => {
          const sum = (k: 'ordered' | 'delivered' | 'invoiced') => billing.reduce((n, b) => n + b[k], 0);
          const worst = billing.find((b) => b.flag === 'over_invoiced') ?? billing.find((b) => b.flag === 'under_invoiced') ?? billing.find((b) => b.flag === 'not_delivered') ?? billing[0];
          const f = worst ? FLAG[worst.flag] : FLAG.not_delivered;
          return <tr key={o.id}><td><code>{o.number}</code></td><td>{customer(o.customerId)}</td><td className="right">{sum('ordered')}</td><td className="right">{sum('delivered')}</td><td className="right">{sum('invoiced')}</td><td><Pill status={f.pill} label={f.label} /></td></tr>;
        })}
        {!rows.length && <tr><td colSpan={6} className="muted empty">No sales orders yet.</td></tr>}
      </tbody></table></div>

      <h2 className="related">Invoices</h2>
      <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Order</th><th>Created</th><th className="right">Amount</th><th>Status</th><th></th></tr></thead><tbody>
        {invoices.data.map((i) => (
          <tr key={i.id}><td><code>{i.number}</code></td><td>{customer(i.customerId)}</td><td><code>{orders.data?.find((o) => o.id === i.orderId)?.number ?? '—'}</code></td><td>{formatDateTime(i.createdAt, session.org)}</td><td className="right">{money(i.totalMinor, i.currency)}</td>
            <td><Pill status={i.status === 'void' ? 'cancelled' : 'received'} label={i.status === 'void' ? 'Void' : 'Issued'} /></td>
            <td>{canManage && i.status === 'issued' && <button className="secondary" disabled={busy} onClick={() => voidInvoice(i.id)}>Void</button>}</td></tr>
        ))}
        {!invoices.data.length && <tr><td colSpan={7} className="muted empty">No invoices yet.</td></tr>}
      </tbody></table></div>
    </section>
  );
}

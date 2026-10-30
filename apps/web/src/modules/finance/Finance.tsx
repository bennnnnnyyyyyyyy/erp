import { useState } from 'react';
import { formatMoney } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill, toMinor } from '../trade/common';

// Expenses and payments (sql/024). Owner and admin only. Amounts are typed in normal units ("18.50") and stored as minor units.

type Category = { id: string; name: string };
type Expense = { id: string; number: string; date: string; categoryId: string; supplierId: string | null; amountMinor: number; currency: string; note: string | null; status: 'recorded' | 'void' };
type Payment = { id: string; number: string; direction: 'in' | 'out'; amountMinor: number; currency: string; paidOn: string; method: string; customerInvoiceId: string | null; supplierInvoiceId: string | null; expenseId: string | null; note: string | null; status: 'recorded' | 'void' };
type CustomerInvoice = { id: string; number: string; status: 'issued' | 'void'; totalMinor: number; currency: string; customerId: string };
type SupplierInvoice = { id: string; number: string; supplierId: string; totalMinor: number; currency: string };
type Named = { id: string; name: string };

const today = () => new Date().toISOString().slice(0, 10);
const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency });
const METHODS = ['cash', 'bank', 'card', 'cheque', 'other'];

function useNotice() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<string>, after: () => void) {
    setBusy(true); setMessage(null);
    try { setMessage({ ok: true, text: await work() }); after(); } catch (e) { setMessage({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  return { message, busy, run };
}

export function ExpensesPage() {
  const session = useSession();
  const categories = useLoad(() => api<Category[]>('/v1/finance/categories'));
  const expenses = useLoad(() => api<Expense[]>('/v1/finance/expenses'));
  const suppliers = useLoad(() => api<Named[]>('/v1/purchasing/suppliers'));
  const { message, busy, run } = useNotice();
  const [date, setDate] = useState(today());
  const [categoryId, setCategoryId] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  if (!categories.data || !expenses.data || !suppliers.data) return <section className="page"><p className="muted">{categories.error ?? expenses.error ?? 'Loading…'}</p></section>;
  const category = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '—';
  const supplier = (id: string | null) => (id ? suppliers.data?.find((s) => s.id === id)?.name ?? '—' : '');
  const total = expenses.data.filter((e) => e.status === 'recorded').reduce((n, e) => n + e.amountMinor, 0);
  const currency = expenses.data[0]?.currency ?? session.org?.defaultCurrency ?? 'EGP';

  return (
    <section className="page wide">
      <h1>Expenses</h1>
      <p className="muted">Rent, salaries, utilities, transport: the costs of running the business that are not stock. They are taken off sales to show profit.</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      <div className="form-card stack">
        <h2>Record an expense</h2>
        <div className="form-row">
          <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Amount<input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label>Supplier (optional)
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">None</option>
              {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="form-row">
          <Button disabled={busy || !categoryId || toMinor(amount) <= 0} onClick={() => run(async () => {
            const made = await api<{ number: string }>('/v1/finance/expenses', { method: 'POST', body: JSON.stringify({ date, categoryId, amountMinor: toMinor(amount), supplierId, note }) });
            return `Expense ${made.number} recorded.`;
          }, () => { setAmount(''); setNote(''); expenses.reload(); })}>{busy ? 'Saving…' : 'Record expense'}</Button>
          <label>New category<input placeholder="e.g. Rent" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} /></label>
          <Button variant="outline" disabled={busy || !newCategory.trim()} onClick={() => run(async () => {
            await api('/v1/finance/categories', { method: 'POST', body: JSON.stringify({ name: newCategory }) });
            return `Category "${newCategory.trim()}" added.`;
          }, () => { setNewCategory(''); categories.reload(); })}>Add category</Button>
        </div>
      </div>

      <h2 className="related">Recorded expenses <span className="muted small">(total {money(total, currency)})</span></h2>
      <div className="table-wrap"><table><thead><tr><th>No.</th><th>Date</th><th>Category</th><th>Supplier</th><th>Note</th><th className="right">Amount</th><th>Status</th><th></th></tr></thead><tbody>
        {expenses.data.map((e) => (
          <tr key={e.id}><td><code>{e.number}</code></td><td>{e.date}</td><td>{category(e.categoryId)}</td><td>{supplier(e.supplierId)}</td><td>{e.note}</td><td className="right">{money(e.amountMinor, e.currency)}</td>
            <td><Pill status={e.status === 'void' ? 'cancelled' : 'received'} label={e.status === 'void' ? 'Void' : 'Recorded'} /></td>
            <td>{e.status === 'recorded' && <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/finance/expenses/${e.id}/void`, { method: 'POST' }); return `${e.number} voided.`; }, () => expenses.reload())}>Void</Button>}</td></tr>
        ))}
        {!expenses.data.length && <tr><td colSpan={8} className="muted empty">No expenses yet.</td></tr>}
      </tbody></table></div>
    </section>
  );
}

export function PaymentsPage() {
  const session = useSession();
  const payments = useLoad(() => api<Payment[]>('/v1/finance/payments'));
  const customerInvoices = useLoad(() => api<CustomerInvoice[]>('/v1/sales/invoices'));
  const supplierInvoices = useLoad(() => api<SupplierInvoice[]>('/v1/purchasing/supplier-invoices'));
  const expenses = useLoad(() => api<Expense[]>('/v1/finance/expenses'));
  const customers = useLoad(() => api<Named[]>('/v1/sales/customers'));
  const suppliers = useLoad(() => api<Named[]>('/v1/purchasing/suppliers'));
  const { message, busy, run } = useNotice();
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState('bank');
  const [note, setNote] = useState('');

  if (!payments.data || !customerInvoices.data || !supplierInvoices.data || !expenses.data || !customers.data || !suppliers.data) {
    return <section className="page"><p className="muted">{payments.error ?? 'Loading…'}</p></section>;
  }
  const paid = (key: 'customerInvoiceId' | 'supplierInvoiceId' | 'expenseId', id: string) =>
    payments.data?.filter((p) => p.status === 'recorded' && p[key] === id).reduce((n, p) => n + p.amountMinor, 0) ?? 0;
  const name = (list: Named[] | null, id: string) => list?.find((x) => x.id === id)?.name ?? '';

  // What can be paid: each target with what is still owed.
  const targets = direction === 'in'
    ? customerInvoices.data.filter((i) => i.status === 'issued').map((i) => ({ value: `c:${i.id}`, label: `${i.number} · ${name(customers.data, i.customerId)}`, left: i.totalMinor - paid('customerInvoiceId', i.id), currency: i.currency }))
    : [
        ...supplierInvoices.data.map((i) => ({ value: `s:${i.id}`, label: `Supplier invoice ${i.number} · ${name(suppliers.data, i.supplierId)}`, left: i.totalMinor - paid('supplierInvoiceId', i.id), currency: i.currency })),
        ...expenses.data.filter((e) => e.status === 'recorded').map((e) => ({ value: `e:${e.id}`, label: `Expense ${e.number}`, left: e.amountMinor - paid('expenseId', e.id), currency: e.currency })),
      ];
  const open = targets.filter((t) => t.left > 0);
  const chosen = open.find((t) => t.value === target);
  const label = (p: Payment) => p.customerInvoiceId ? customerInvoices.data?.find((i) => i.id === p.customerInvoiceId)?.number ?? 'Invoice'
    : p.supplierInvoiceId ? `Supplier invoice ${supplierInvoices.data?.find((i) => i.id === p.supplierInvoiceId)?.number ?? ''}`
    : `Expense ${expenses.data?.find((e) => e.id === p.expenseId)?.number ?? ''}`;
  const currency = session.org?.defaultCurrency ?? 'EGP';

  return (
    <section className="page wide">
      <h1>Payments</h1>
      <p className="muted">Money received from customers and money paid to suppliers and for expenses. A payment can never be more than what is still owed.</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      <div className="form-card stack">
        <h2>Record a payment</h2>
        <div className="form-row">
          <label>Direction
            <select value={direction} onChange={(e) => { setDirection(e.target.value as 'in' | 'out'); setTarget(''); }}>
              <option value="in">Money received from a customer</option>
              <option value="out">Money paid out</option>
            </select>
          </label>
          <label>For
            <select value={target} onChange={(e) => { setTarget(e.target.value); const t = open.find((x) => x.value === e.target.value); if (t) setAmount((t.left / 100).toFixed(2)); }}>
              <option value="">Choose…</option>
              {open.map((t) => <option key={t.value} value={t.value}>{t.label} · owed {money(t.left, t.currency)}</option>)}
            </select>
          </label>
          <label>Amount<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <div className="form-row">
          <label>Date<input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label>Method<select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div><Button disabled={busy || !chosen || toMinor(amount) <= 0 || toMinor(amount) > (chosen?.left ?? 0)} onClick={() => run(async () => {
          const [kind, id] = target.split(':');
          const made = await api<{ number: string }>('/v1/finance/payments', { method: 'POST', body: JSON.stringify({
            direction, amountMinor: toMinor(amount), paidOn, method, note,
            customerInvoiceId: kind === 'c' ? id : undefined, supplierInvoiceId: kind === 's' ? id : undefined, expenseId: kind === 'e' ? id : undefined,
          }) });
          return `Payment ${made.number} recorded.`;
        }, () => { setTarget(''); setAmount(''); setNote(''); payments.reload(); })}>{busy ? 'Saving…' : 'Record payment'}</Button>
        {chosen && toMinor(amount) > chosen.left && <span className="error small"> More than the {money(chosen.left, chosen.currency)} still owed.</span>}</div>
      </div>

      <h2 className="related">Payments</h2>
      <div className="table-wrap"><table><thead><tr><th>No.</th><th>Date</th><th>Direction</th><th>For</th><th>Method</th><th className="right">Amount</th><th>Status</th><th></th></tr></thead><tbody>
        {payments.data.map((p) => (
          <tr key={p.id}><td><code>{p.number}</code></td><td>{p.paidOn}</td><td><Pill status={p.direction === 'in' ? 'received' : 'ordered'} label={p.direction === 'in' ? 'Received' : 'Paid'} /></td><td>{label(p)}</td><td>{p.method}</td>
            <td className="right">{money(p.amountMinor, p.currency || currency)}</td>
            <td><Pill status={p.status === 'void' ? 'cancelled' : 'received'} label={p.status === 'void' ? 'Void' : 'Recorded'} /></td>
            <td>{p.status === 'recorded' && <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/finance/payments/${p.id}/void`, { method: 'POST' }); return `${p.number} voided.`; }, () => payments.reload())}>Void</Button>}</td></tr>
        ))}
        {!payments.data.length && <tr><td colSpan={8} className="muted empty">No payments yet.</td></tr>}
      </tbody></table></div>
    </section>
  );
}

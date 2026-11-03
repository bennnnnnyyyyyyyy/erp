import { useEffect, useState } from 'react';
import { Loading } from '../../components/Loading';
import { formatMoney } from '@erp/shared';
import { ClickRow } from '../../components/ClickRow';
import { FormToggle } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill, toMinor } from '../trade/common';

import { tr, trf } from '../../lib/i18n';
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

  if (!categories.data || !expenses.data || !suppliers.data) return <section className="page"><Loading error={categories.error ?? expenses.error} /></section>;
  const category = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '—';
  const supplier = (id: string | null) => (id ? suppliers.data?.find((s) => s.id === id)?.name ?? '—' : '');
  const total = expenses.data.filter((e) => e.status === 'recorded').reduce((n, e) => n + e.amountMinor, 0);
  const currency = expenses.data[0]?.currency ?? session.org?.defaultCurrency ?? 'EGP';

  return (
    <section className="page wide">
      <h1>{tr('Expenses')}</h1>
      <p className="muted">{tr('Running costs that are not stock, such as rent, salaries and transport.')}</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      <FormToggle label={tr('Record an expense')}>
        <div className="form-row">
          <label>{tr('Date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>{tr('Category')}
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{tr('Choose…')}</option>
              {categories.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{tr('Amount')}<input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label>{tr('Supplier (optional)')}
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{tr('None')}</option>
              {suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
        <label>{tr('Note (optional)')}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className="form-row">
          <Button disabled={busy || !categoryId || toMinor(amount) <= 0} onClick={() => run(async () => {
            const made = await api<{ number: string }>('/v1/finance/expenses', { method: 'POST', body: JSON.stringify({ date, categoryId, amountMinor: toMinor(amount), supplierId, note }) });
            return trf('Expense {number} recorded.', { number: made.number });
          }, () => { setAmount(''); setNote(''); expenses.reload(); })}>{busy ? tr('Saving…') : tr('Record expense')}</Button>
          <label>{tr('New category')}<input placeholder={tr('e.g. Rent')} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} /></label>
          <Button variant="outline" disabled={busy || !newCategory.trim()} onClick={() => run(async () => {
            await api('/v1/finance/categories', { method: 'POST', body: JSON.stringify({ name: newCategory }) });
            return trf('Category "{name}" added.', { name: newCategory.trim() });
          }, () => { setNewCategory(''); categories.reload(); })}>{tr('Add category')}</Button>
        </div>
      </FormToggle>

      <h2 className="related">{tr('Recorded expenses')} <span className="muted small">{trf('(total {amount})', { amount: money(total, currency) })}</span></h2>
      <div className="table-wrap"><table><thead><tr><th>{tr('No.')}</th><th>{tr('Date')}</th><th>{tr('Category')}</th><th>{tr('Supplier')}</th><th>{tr('Note')}</th><th className="right">{tr('Amount')}</th><th>{tr('Status')}</th></tr></thead><tbody>
        {expenses.data.map((e) => (
          <ClickRow key={e.id} to={`/finance/expenses/${e.id}`}><td><Link to={`/finance/expenses/${e.id}`}><code>{e.number}</code></Link></td><td className="nowrap">{e.date}</td><td>{category(e.categoryId)}</td><td>{supplier(e.supplierId)}</td><td>{e.note}</td><td className="right">{money(e.amountMinor, e.currency)}</td>
            <td><Pill status={e.status === 'void' ? 'cancelled' : 'received'} label={e.status === 'void' ? tr('Void') : tr('Recorded')} /></td></ClickRow>
        ))}
        {!expenses.data.length && <tr><td colSpan={7} className="muted empty">{tr('No expenses yet.')}</td></tr>}
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
  // "Record a payment →" on an invoice or expense page links here with ?for=c:<id> (customer invoice), s:<id> (supplier invoice) or
  // e:<id> (expense): the form opens already pointing at it, with what is still owed as the amount.
  const [preset] = useState(() => { const f = new URLSearchParams(window.location.search).get('for') ?? ''; return /^[cse]:[0-9a-f-]{36}$/i.test(f) ? f : ''; });
  const [direction, setDirection] = useState<'in' | 'out'>(preset.startsWith('c:') || !preset ? 'in' : 'out');
  const [target, setTarget] = useState(preset);
  const [formOpen, setFormOpen] = useState(preset !== '');
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState('bank');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!preset || !payments.data || !customerInvoices.data || !supplierInvoices.data || !expenses.data) return;
    const [kind, id] = preset.split(':');
    const total = kind === 'c' ? customerInvoices.data.find((i) => i.id === id)?.totalMinor : kind === 's' ? supplierInvoices.data.find((i) => i.id === id)?.totalMinor : expenses.data.find((e) => e.id === id)?.amountMinor;
    const key = kind === 'c' ? 'customerInvoiceId' : kind === 's' ? 'supplierInvoiceId' : 'expenseId';
    const paidSoFar = payments.data.filter((p) => p.status === 'recorded' && p[key] === id).reduce((n, p) => n + p.amountMinor, 0);
    if (total !== undefined && total - paidSoFar > 0) setAmount(((total - paidSoFar) / 100).toFixed(2));
  }, [preset, payments.data, customerInvoices.data, supplierInvoices.data, expenses.data]);

  if (!payments.data || !customerInvoices.data || !supplierInvoices.data || !expenses.data || !customers.data || !suppliers.data) {
    return <section className="page"><Loading error={payments.error} /></section>;
  }
  const paid = (key: 'customerInvoiceId' | 'supplierInvoiceId' | 'expenseId', id: string) =>
    payments.data?.filter((p) => p.status === 'recorded' && p[key] === id).reduce((n, p) => n + p.amountMinor, 0) ?? 0;
  const name = (list: Named[] | null, id: string) => list?.find((x) => x.id === id)?.name ?? '';

  // What can be paid: each target with what is still owed.
  const targets = direction === 'in'
    ? customerInvoices.data.filter((i) => i.status === 'issued').map((i) => ({ value: `c:${i.id}`, label: `${i.number} · ${name(customers.data, i.customerId)}`, left: i.totalMinor - paid('customerInvoiceId', i.id), currency: i.currency }))
    : [
        ...supplierInvoices.data.map((i) => ({ value: `s:${i.id}`, label: `${trf('Supplier invoice {number}', { number: i.number })} · ${name(suppliers.data, i.supplierId)}`, left: i.totalMinor - paid('supplierInvoiceId', i.id), currency: i.currency })),
        ...expenses.data.filter((e) => e.status === 'recorded').map((e) => ({ value: `e:${e.id}`, label: trf('Expense {number}', { number: e.number }), left: e.amountMinor - paid('expenseId', e.id), currency: e.currency })),
      ];
  const open = targets.filter((t) => t.left > 0);
  const chosen = open.find((t) => t.value === target);
  const label = (p: Payment) => p.customerInvoiceId ? customerInvoices.data?.find((i) => i.id === p.customerInvoiceId)?.number ?? 'Invoice'
    : p.supplierInvoiceId ? trf('Supplier invoice {number}', { number: supplierInvoices.data?.find((i) => i.id === p.supplierInvoiceId)?.number ?? '' })
    : trf('Expense {number}', { number: expenses.data?.find((e) => e.id === p.expenseId)?.number ?? '' });
  const targetPath = (p: Payment) => p.customerInvoiceId ? `/sales/invoices/${p.customerInvoiceId}` : p.supplierInvoiceId ? `/purchasing/invoices/${p.supplierInvoiceId}` : `/finance/expenses/${p.expenseId}`;
  const currency = session.org?.defaultCurrency ?? 'EGP';

  return (
    <section className="page wide">
      <h1>{tr('Payments')}</h1>
      <p className="muted">{tr('Money in from customers, and money out to suppliers and for expenses.')}</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      <FormToggle label={tr('Record a payment')} open={formOpen} onOpenChange={setFormOpen}>
        <div className="form-row">
          <label>{tr('Direction')}
            <select value={direction} onChange={(e) => { setDirection(e.target.value as 'in' | 'out'); setTarget(''); }}>
              <option value="in">{tr('Money received from a customer')}</option>
              <option value="out">{tr('Money paid out')}</option>
            </select>
          </label>
          <label>{tr('For')}
            <select value={target} onChange={(e) => { setTarget(e.target.value); const t = open.find((x) => x.value === e.target.value); if (t) setAmount((t.left / 100).toFixed(2)); }}>
              <option value="">{tr('Choose…')}</option>
              {open.map((t) => <option key={t.value} value={t.value}>{t.label} {tr('· owed')} {money(t.left, t.currency)}</option>)}
            </select>
          </label>
          <label>{tr('Amount')}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <div className="form-row">
          <label>{tr('Date')}<input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label>{tr('Method')}<select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m} value={m}>{tr(m)}</option>)}</select></label>
          <label>{tr('Note (optional)')}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div><Button disabled={busy || !chosen || toMinor(amount) <= 0 || toMinor(amount) > (chosen?.left ?? 0)} onClick={() => run(async () => {
          const [kind, id] = target.split(':');
          const made = await api<{ number: string }>('/v1/finance/payments', { method: 'POST', body: JSON.stringify({
            direction, amountMinor: toMinor(amount), paidOn, method, note,
            customerInvoiceId: kind === 'c' ? id : undefined, supplierInvoiceId: kind === 's' ? id : undefined, expenseId: kind === 'e' ? id : undefined,
          }) });
          return trf('Payment {number} recorded.', { number: made.number });
        }, () => { setTarget(''); setAmount(''); setNote(''); payments.reload(); })}>{busy ? tr('Saving…') : tr('Record payment')}</Button>
        {chosen && toMinor(amount) > chosen.left && <span className="error small"> {trf('More than the {amount} still owed.', { amount: money(chosen.left, chosen.currency) })}</span>}</div>
      </FormToggle>

      <h2 className="related">{tr('Payments')}</h2>
      <div className="table-wrap"><table><thead><tr><th>{tr('No.')}</th><th>{tr('Date')}</th><th>{tr('Direction')}</th><th>{tr('For')}</th><th>{tr('Method')}</th><th className="right">{tr('Amount')}</th><th>{tr('Status')}</th></tr></thead><tbody>
        {payments.data.map((p) => (
          <ClickRow key={p.id} to={`/finance/payments/${p.id}`}><td><Link to={`/finance/payments/${p.id}`}><code>{p.number}</code></Link></td><td className="nowrap">{p.paidOn}</td><td><Pill status={p.direction === 'in' ? 'received' : 'ordered'} label={p.direction === 'in' ? tr('Received') : tr('Paid')} /></td><td><Link to={targetPath(p)}>{label(p)}</Link></td><td>{tr(p.method)}</td>
            <td className="right">{money(p.amountMinor, p.currency || currency)}</td>
            <td><Pill status={p.status === 'void' ? 'cancelled' : 'received'} label={p.status === 'void' ? tr('Void') : tr('Recorded')} /></td></ClickRow>
        ))}
        {!payments.data.length && <tr><td colSpan={7} className="muted empty">{tr('No payments yet.')}</td></tr>}
      </tbody></table></div>
    </section>
  );
}

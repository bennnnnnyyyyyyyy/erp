import { useEffect, useState } from 'react';
import { formatDay } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { formatMoney, hasPermission, type TreasuryAccount } from '@erp/shared';
import { ClickRow } from '../../components/ClickRow';
import { FormToggle } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { todayIn } from '../../lib/dates';
import { Pill, toMinor } from '../trade/common';

import { tr, trf } from '../../lib/i18n';
// Expenses and payments (sql/024). Owner and admin only. Amounts are typed in normal units ("18.50") and stored as minor units.

type Category = { id: string; name: string };
type Expense = { id: string; number: string; date: string; categoryId: string; supplierId: string | null; amountMinor: number; currency: string; note: string | null; status: 'recorded' | 'void' };
type Payment = { id: string; number: string; direction: 'in' | 'out'; amountMinor: number; currency: string; paidOn: string; method: string; customerInvoiceId: string | null; supplierInvoiceId: string | null; expenseId: string | null; targetNumber: string | null; note: string | null; status: 'recorded' | 'void' };
/** An invoice or expense with money still outstanding (GET /v1/finance/open-items). */
type OpenItem = { value: string; kind: 'customer_invoice' | 'supplier_invoice' | 'expense'; id: string; number: string; partyId: string | null; currency: string; totalMinor: number; paidMinor: number; leftMinor: number; detail?: string };
type Named = { id: string; name: string };

const today = () => todayIn();   // company time zone (decision D11)
/** The cash box or bank account this browser last used for a payment method (a convenience only; the database checks the choice). */
const lastBox = (method: string) => {
  try {
    return localStorage.getItem(`erp.treasury.last.${method}`) ?? '';
  } catch {
    return '';
  }
};
const rememberBox = (method: string, id: string) => {
  try {
    localStorage.setItem(`erp.treasury.last.${method}`, id);
  } catch {
    // storage blocked: the picker just starts empty next time
  }
};
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
  const suppliers = useLoad(() => api<Named[]>('/v1/purchasing/suppliers').catch(() => [] as Named[]));   // purchasing may be off
  const { message, busy, run } = useNotice();
  const [date, setDate] = useState(today());
  const [categoryId, setCategoryId] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  // "Paid now" (decision D7, 9 Nov 2026): record the payment with the expense. With treasury on, the money comes from a cash box or bank
  // account, starting on the one this person used last; without treasury, from cash or bank.
  const canPay = hasPermission(session.permissions, 'finance.entries.manage');
  const treasuryOn = session.modules.includes('treasury');
  const boxes = useLoad(() => (treasuryOn ? api<TreasuryAccount[]>('/v1/treasury/accounts').catch(() => [] as TreasuryAccount[]) : Promise.resolve([] as TreasuryAccount[])));
  const [paidNow, setPaidNow] = useState(false);
  const [payFrom, setPayFrom] = useState(() => lastBox('expense') || 'cash');

  if (!categories.data || !expenses.data || !suppliers.data) return <section className="page"><Loading error={categories.error ?? expenses.error} /></section>;
  const category = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? '—';
  const supplier = (id: string | null) => (id ? suppliers.data?.find((s) => s.id === id)?.name ?? '—' : '');
  // With treasury on, "Paid from" is a box: start on the remembered one if it still exists, else the first.
  const payBoxes = (boxes.data ?? []).filter((b) => b.active && (b.kind === 'cash' || b.kind === 'bank'));
  const fromValue = treasuryOn && !payBoxes.some((b) => b.id === payFrom) ? (payBoxes[0]?.id ?? '') : payFrom;
  const total = expenses.data.filter((e) => e.status === 'recorded').reduce((n, e) => n + e.amountMinor, 0);
  const currency = expenses.data[0]?.currency ?? session.org?.defaultCurrency ?? 'EGP';

  return (
    <section className="page wide">
      <h1>{tr('Expenses')}</h1>
      <p className="muted">{tr('Operating expenses such as rent, salaries, utilities and transport.')}</p>
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
        {canPay ? (
          <div className="form-row">
            <label className="flex items-center gap-2"><input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} />{tr('Paid now')}</label>
            {paidNow ? (
              <label>{tr('Paid from')}
                <select value={fromValue} onChange={(e) => setPayFrom(e.target.value)}>
                  {treasuryOn
                    ? payBoxes.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)
                    : (['cash', 'bank'] as const).map((m) => <option key={m} value={m}>{tr(m)}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="form-row">
          <Button disabled={busy || !categoryId || toMinor(amount) <= 0} onClick={() => run(async () => {
            const made = await api<{ id: string; number: string }>('/v1/finance/expenses', { method: 'POST', body: JSON.stringify({ date, categoryId, amountMinor: toMinor(amount), supplierId, note }) });
            if (!paidNow) return trf('Expense {number} recorded.', { number: made.number });
            // The payment is a second step: if it is refused, the expense stays recorded and unpaid, and the message says so.
            const box = treasuryOn ? payBoxes.find((b) => b.id === fromValue) : undefined;
            const method = box ? box.kind : fromValue === 'bank' ? 'bank' : 'cash';
            try {
              await api('/v1/finance/payments', { method: 'POST', body: JSON.stringify({
                direction: 'out', amountMinor: toMinor(amount), paidOn: date, method, expenseId: made.id, treasuryAccountId: box?.id,
              }) });
            } catch (err) {
              return trf('Expense {number} recorded, but the payment was not: {reason}. Pay it from Payments.', { number: made.number, reason: (err as Error).message });
            }
            rememberBox('expense', fromValue);
            return trf('Expense {number} recorded and paid.', { number: made.number });
          }, () => { setAmount(''); setNote(''); expenses.reload(); })}>{busy ? tr('Saving…') : paidNow ? tr('Record expense and payment') : tr('Record expense')}</Button>
          <label>{tr('New category')}<input placeholder={tr('e.g. Rent')} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} /></label>
          <Button variant="outline" disabled={busy || !newCategory.trim()} onClick={() => run(async () => {
            await api('/v1/finance/categories', { method: 'POST', body: JSON.stringify({ name: newCategory }) });
            return trf('Category "{name}" added.', { name: newCategory.trim() });
          }, () => { setNewCategory(''); categories.reload(); })}>{tr('Add category')}</Button>
        </div>
      </FormToggle>

      <h2 className="related">{tr('Recorded expenses')} <span className="muted small">{trf('(total {amount})', { amount: money(total, currency) })}</span></h2>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('No.')}</th><th scope="col">{tr('Date')}</th><th scope="col">{tr('Category')}</th><th scope="col">{tr('Supplier')}</th><th scope="col">{tr('Note')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col">{tr('Status')}</th></tr></thead><tbody>
        {expenses.data.map((e) => (
          <ClickRow key={e.id} to={`/finance/expenses/${e.id}`}><td><Link to={`/finance/expenses/${e.id}`}><code>{e.number}</code></Link></td><td className="nowrap">{formatDay(e.date, session.org)}</td><td>{category(e.categoryId)}</td><td>{supplier(e.supplierId)}</td><td>{e.note}</td><td className="right">{money(e.amountMinor, e.currency)}</td>
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
  // What can still be paid, with the outstanding balance worked out on the server over ALL payments (audit finding 1). Both
  // directions are loaded once, so switching the direction needs no second request.
  const openIn = useLoad(() => api<OpenItem[]>('/v1/finance/open-items?direction=in'));
  const openOut = useLoad(() => api<OpenItem[]>('/v1/finance/open-items?direction=out'));
  const customers = useLoad(() => api<Named[]>('/v1/sales/customers').catch(() => [] as Named[]));   // sales may be off
  const suppliers = useLoad(() => api<Named[]>('/v1/purchasing/suppliers').catch(() => [] as Named[]));   // purchasing may be off
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
  // Treasury (sql/051): with treasury on, a cash or bank payment names the cash box or bank account it went through, defaulting to
  // the one this person used last for that method.
  const treasuryOn = session.modules.includes('treasury');
  const treasury = useLoad(() => (treasuryOn ? api<TreasuryAccount[]>('/v1/treasury/accounts').catch(() => [] as TreasuryAccount[]) : Promise.resolve([] as TreasuryAccount[])));
  const [boxId, setBoxId] = useState(() => lastBox('bank'));
  useEffect(() => {
    if (!preset || !openIn.data || !openOut.data) return;
    const item = [...openIn.data, ...openOut.data].find((t) => t.value === preset);
    if (item) setAmount((item.leftMinor / 100).toFixed(2));
  }, [preset, openIn.data, openOut.data]);

  if (!payments.data || !openIn.data || !openOut.data || !customers.data || !suppliers.data) {
    return <section className="page"><Loading error={payments.error ?? openIn.error ?? openOut.error} /></section>;
  }
  const name = (list: Named[] | null, id: string | null) => (id ? list?.find((x) => x.id === id)?.name ?? '' : '');

  // What can be paid: each open item with what is still outstanding (from the server).
  const open = (direction === 'in' ? openIn.data : openOut.data).map((t) => ({
    value: t.value,
    label: t.kind === 'customer_invoice' ? `${t.number} · ${name(customers.data, t.partyId)}`
      : t.kind === 'supplier_invoice' ? `${trf('Purchase invoice {number}', { number: t.number })} · ${name(suppliers.data, t.partyId)}`
      // Category, note and supplier, so unpaid expenses can be told apart (decision D7).
      : [trf('Expense {number}', { number: t.number }), t.detail, name(suppliers.data, t.partyId)].filter(Boolean).join(' · '),
    left: t.leftMinor,
    currency: t.currency,
  }));
  const chosen = open.find((t) => t.value === target);
  const needsBox = treasuryOn && (method === 'cash' || method === 'bank');
  const boxes = (treasury.data ?? []).filter((b) => b.active && b.kind === method && (!chosen || b.currency === chosen.currency));
  const label = (p: Payment) => p.customerInvoiceId ? p.targetNumber ?? tr('Sales invoice')
    : p.supplierInvoiceId ? trf('Purchase invoice {number}', { number: p.targetNumber ?? '' })
    : trf('Expense {number}', { number: p.targetNumber ?? '' });
  const targetPath = (p: Payment) => p.customerInvoiceId ? `/sales/invoices/${p.customerInvoiceId}` : p.supplierInvoiceId ? `/purchasing/invoices/${p.supplierInvoiceId}` : `/finance/expenses/${p.expenseId}`;
  const currency = session.org?.defaultCurrency ?? 'EGP';

  return (
    <section className="page wide">
      <h1>{tr('Payments')}</h1>
      <p className="muted">{tr('Customer receipts, and payments to suppliers and for expenses.')}</p>
      {message && <p className={message.ok ? 'notice' : 'error notice'}>{message.text}</p>}

      <FormToggle label={tr('Record a payment')} open={formOpen} onOpenChange={setFormOpen}>
        <div className="form-row">
          <label>{tr('Payment type')}
            <select value={direction} onChange={(e) => { setDirection(e.target.value as 'in' | 'out'); setTarget(''); }}>
              <option value="in">{tr('Customer receipt')}</option>
              <option value="out">{tr('Payment to supplier or expense')}</option>
            </select>
          </label>
          <label>{tr('For')}
            <select value={target} onChange={(e) => { setTarget(e.target.value); const t = open.find((x) => x.value === e.target.value); if (t) setAmount((t.left / 100).toFixed(2)); }}>
              <option value="">{tr('Choose…')}</option>
              {open.map((t) => <option key={t.value} value={t.value}>{t.label} {tr('· outstanding')} {money(t.left, t.currency)}</option>)}
            </select>
          </label>
          <label>{tr('Amount')}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <div className="form-row">
          <label>{tr('Date')}<input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label>{tr('Method')}<select value={method} onChange={(e) => { setMethod(e.target.value); setBoxId(lastBox(e.target.value)); }}>{METHODS.map((m) => <option key={m} value={m}>{tr(m)}</option>)}</select></label>
          {needsBox ? (
            <label>{direction === 'in' ? tr('Paid into') : tr('Paid from')}
              <select value={boxId} onChange={(e) => setBoxId(e.target.value)}>
                <option value="">{tr('Choose…')}</option>
                {boxes.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </label>
          ) : null}
          <label>{tr('Note (optional)')}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <div><Button disabled={busy || !chosen || toMinor(amount) <= 0 || toMinor(amount) > (chosen?.left ?? 0) || (needsBox && !boxes.some((b) => b.id === boxId))} onClick={() => run(async () => {
          const [kind, id] = target.split(':');
          const made = await api<{ number: string }>('/v1/finance/payments', { method: 'POST', body: JSON.stringify({
            direction, amountMinor: toMinor(amount), paidOn, method, note,
            customerInvoiceId: kind === 'c' ? id : undefined, supplierInvoiceId: kind === 's' ? id : undefined, expenseId: kind === 'e' ? id : undefined,
            treasuryAccountId: needsBox ? boxId : undefined,
          }) });
          if (needsBox) rememberBox(method, boxId);
          return trf('Payment {number} recorded.', { number: made.number });
        }, () => { setTarget(''); setAmount(''); setNote(''); payments.reload(); openIn.reload(); openOut.reload(); })}>{busy ? tr('Saving…') : tr('Record payment')}</Button>
        {chosen && toMinor(amount) > chosen.left && <span className="error small"> {trf('Exceeds the outstanding balance of {amount}.', { amount: money(chosen.left, chosen.currency) })}</span>}</div>
      </FormToggle>

      <h2 className="related">{tr('Payments')}</h2>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('No.')}</th><th scope="col">{tr('Date')}</th><th scope="col">{tr('Payment type')}</th><th scope="col">{tr('For')}</th><th scope="col">{tr('Method')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col">{tr('Status')}</th></tr></thead><tbody>
        {payments.data.map((p) => (
          <ClickRow key={p.id} to={`/finance/payments/${p.id}`}><td><Link to={`/finance/payments/${p.id}`}><code>{p.number}</code></Link></td><td className="nowrap">{formatDay(p.paidOn, session.org)}</td><td><Pill status={p.direction === 'in' ? 'received' : 'ordered'} label={p.direction === 'in' ? tr('Received') : tr('Paid')} /></td><td><Link to={targetPath(p)}>{label(p)}</Link></td><td>{tr(p.method)}</td>
            <td className="right">{money(p.amountMinor, p.currency || currency)}</td>
            <td><Pill status={p.status === 'void' ? 'cancelled' : 'received'} label={p.status === 'void' ? tr('Void') : tr('Recorded')} /></td></ClickRow>
        ))}
        {!payments.data.length && <tr><td colSpan={7} className="muted empty">{tr('No payments yet.')}</td></tr>}
      </tbody></table></div>
    </section>
  );
}

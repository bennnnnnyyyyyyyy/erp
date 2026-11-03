import { useState } from 'react';
import { formatDay } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { formatMoney, hasPermission } from '@erp/shared';
import { ClickRow } from '../../components/ClickRow';
import { RecordHistory } from '../../components/RecordHistory';
import { ConfirmButton } from '../../components/FormToggle';
import { api } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { Link, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';

// One payment and one expense on their own page, and the "Payments" block shown on an invoice or expense page. Everything comes from the
// list endpoints the Payments and Expenses screens already use (owner/admin only, finance.reports.view); voiding goes through the same
// database functions as the list's Void button.

export type Payment = { id: string; number: string; direction: 'in' | 'out'; amountMinor: number; currency: string; paidOn: string; method: string; customerInvoiceId: string | null; supplierInvoiceId: string | null; expenseId: string | null; note: string | null; status: 'recorded' | 'void'; createdAt?: string };
type Expense = { id: string; number: string; date: string; categoryId: string; supplierId: string | null; amountMinor: number; currency: string; note: string | null; status: 'recorded' | 'void'; createdAt?: string };
type CustomerInvoice = { id: string; number: string; customerId: string };
type SupplierInvoice = { id: string; number: string; supplierId: string };
type Named = { id: string; name: string };

const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency });
const none = <T,>() => Promise.resolve([] as T[]);

export function PaymentStatus({ status }: { status: 'recorded' | 'void' }) {
  return <Pill status={status === 'void' ? 'cancelled' : 'received'} label={status === 'void' ? tr('Void') : tr('Recorded')} />;
}

/** Payments recorded against one invoice or expense, with what is paid and what is still owed. Hidden for people without finance access. */
export function PaymentsAgainst({ field, id, totalMinor, currency }: { field: 'customerInvoiceId' | 'supplierInvoiceId' | 'expenseId'; id: string; totalMinor: number; currency: string }) {
  const session = useSession();
  const allowed = hasPermission(session.permissions, 'finance.reports.view');
  const payments = useLoad(() => (allowed ? api<Payment[]>('/v1/finance/payments') : none<Payment>()));
  if (!allowed) return null;
  const rows = (payments.data ?? []).filter((p) => p[field] === id);
  const paid = rows.filter((p) => p.status === 'recorded').reduce((n, p) => n + p.amountMinor, 0);
  const left = totalMinor - paid;
  return (
    <>
      <h2 className="related">{tr('Payments')} <span className="muted small">{left > 0 ? trf('{paid} paid · {left} outstanding', { paid: money(paid, currency), left: money(left, currency) }) : paid > 0 ? tr('Paid in full') : ''}</span></h2>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('No.')}</th><th scope="col">{tr('Date')}</th><th scope="col">{tr('Method')}</th><th scope="col" className="right">{tr('Amount')}</th><th scope="col">{tr('Status')}</th></tr></thead><tbody>
        {rows.map((p) => (
          <ClickRow key={p.id} to={`/finance/payments/${p.id}`}>
            <td><Link to={`/finance/payments/${p.id}`}><code>{p.number}</code></Link></td><td>{formatDay(p.paidOn, session.org)}</td><td>{tr(p.method)}</td>
            <td className="right">{money(p.amountMinor, p.currency || currency)}</td><td><PaymentStatus status={p.status} /></td>
          </ClickRow>
        ))}
        {!rows.length && <tr><td colSpan={5} className="muted empty">{payments.data ? tr('No payments recorded yet.') : tr('Loading…')}</td></tr>}
      </tbody></table></div>
      {left > 0 && hasPermission(session.permissions, 'finance.entries.manage') && (
        <p className="small"><Link to={`/finance/payments?for=${field === 'customerInvoiceId' ? 'c' : field === 'supplierInvoiceId' ? 's' : 'e'}:${id}`}>{tr('Record a payment →')}</Link></p>
      )}
    </>
  );
}

function useVoid(path: string, done: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(number: string) {
    setBusy(true); setMessage(null);
    try { await api(path, { method: 'POST' }); setMessage({ ok: true, text: trf('{number} voided.', { number }) }); done(); }
    catch (e) { setMessage({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }
  return { busy, message, run };
}

export function PaymentPage() {
  const id = useParam('id');
  const session = useSession();
  const payments = useLoad(() => api<Payment[]>('/v1/finance/payments'));
  const customerInvoices = useLoad(() => (hasPermission(session.permissions, 'sales.invoices.read') ? api<CustomerInvoice[]>('/v1/sales/invoices') : none<CustomerInvoice>()));
  const supplierInvoices = useLoad(() => (hasPermission(session.permissions, 'purchasing.invoices.read') ? api<SupplierInvoice[]>('/v1/purchasing/supplier-invoices') : none<SupplierInvoice>()));
  const expenses = useLoad(() => api<Expense[]>('/v1/finance/expenses'));
  const customers = useLoad(() => (hasPermission(session.permissions, 'sales.customers.read') ? api<Named[]>('/v1/sales/customers') : none<Named>()));
  const suppliers = useLoad(() => api<Named[]>('/v1/purchasing/suppliers').catch(() => [] as Named[]));
  const voiding = useVoid(`/v1/finance/payments/${id}/void`, () => payments.reload());

  if (payments.error) return <section className="page"><p className="error">{payments.error}</p></section>;
  if (!payments.data) return <section className="page"><Loading /></section>;
  const p = payments.data.find((x) => x.id === id);
  if (!p) return <section className="page"><Link to="/finance/payments" className="back-link">{tr('← Payments')}</Link><p className="muted">{tr('This payment was not found.')}</p></section>;

  const name = (list: Named[] | null, x: string | undefined) => list?.find((n) => n.id === x)?.name ?? '';
  const ci = p.customerInvoiceId ? customerInvoices.data?.find((i) => i.id === p.customerInvoiceId) : undefined;
  const si = p.supplierInvoiceId ? supplierInvoices.data?.find((i) => i.id === p.supplierInvoiceId) : undefined;
  const ex = p.expenseId ? expenses.data?.find((e) => e.id === p.expenseId) : undefined;
  const target = p.customerInvoiceId
    ? <Link to={`/sales/invoices/${p.customerInvoiceId}`}><code>{ci?.number ?? tr('Sales invoice')}</code></Link>
    : p.supplierInvoiceId
      ? <Link to={`/purchasing/invoices/${p.supplierInvoiceId}`}><code>{si?.number ?? tr('Purchase invoice')}</code></Link>
      : p.expenseId ? <Link to={`/finance/expenses/${p.expenseId}`}><code>{ex?.number ?? tr('Expense')}</code></Link> : '—';
  const party = ci ? name(customers.data, ci.customerId) : si ? name(suppliers.data, si.supplierId) : ex?.supplierId ? name(suppliers.data, ex.supplierId) : '';
  const canVoid = p.status === 'recorded' && hasPermission(session.permissions, 'finance.entries.manage');

  return (
    <section className="page">
      <Link to="/finance/payments" className="back-link">{tr('← Payments')}</Link>
      <div className="page-head">
        <h1 className="mono">{p.number}</h1>
        <Pill status={p.direction === 'in' ? 'received' : 'ordered'} label={p.direction === 'in' ? tr('Customer receipt') : tr('Payment to supplier or expense')} />
        <PaymentStatus status={p.status} />
      </div>
      {voiding.message && <p className={voiding.message.ok ? 'notice' : 'error notice'}>{voiding.message.text}</p>}
      <dl className="facts">
        <div><dt>{tr('Amount')}</dt><dd className="amount">{money(p.amountMinor, p.currency)}</dd></div>
        <div><dt>{tr('Date')}</dt><dd>{formatDay(p.paidOn, session.org)}</dd></div>
        <div><dt>{tr('Method')}</dt><dd>{tr(p.method)}</dd></div>
        <div><dt>{tr('For')}</dt><dd>{target}</dd></div>
        {party && <div><dt>{p.direction === 'in' ? tr('Customer') : tr('Supplier')}</dt><dd>{party}</dd></div>}
        {p.note && <div><dt>{tr('Note')}</dt><dd>{p.note}</dd></div>}
      </dl>
      {p.status === 'void' && <p className="muted">{tr('This payment was voided. It no longer counts towards what has been paid.')}</p>}
      {canVoid && <div className="form-actions"><ConfirmButton label={tr('Void payment')} confirmLabel={tr('Yes, void it')} question={tr('Void this payment? It can not be undone.')} disabled={voiding.busy} onConfirm={() => voiding.run(p.number)} /></div>}
      <RecordHistory key={p.id} id={p.id} />
    </section>
  );
}

export function ExpensePage() {
  const id = useParam('id');
  const session = useSession();
  const expenses = useLoad(() => api<Expense[]>('/v1/finance/expenses'));
  const categories = useLoad(() => api<Named[]>('/v1/finance/categories'));
  const suppliers = useLoad(() => api<Named[]>('/v1/purchasing/suppliers').catch(() => [] as Named[]));
  const voiding = useVoid(`/v1/finance/expenses/${id}/void`, () => expenses.reload());

  if (expenses.error) return <section className="page"><p className="error">{expenses.error}</p></section>;
  if (!expenses.data) return <section className="page"><Loading /></section>;
  const e = expenses.data.find((x) => x.id === id);
  if (!e) return <section className="page"><Link to="/finance" className="back-link">{tr('← Expenses')}</Link><p className="muted">{tr('This expense was not found.')}</p></section>;
  const category = categories.data?.find((c) => c.id === e.categoryId)?.name ?? '—';
  const supplier = e.supplierId ? suppliers.data?.find((s) => s.id === e.supplierId)?.name ?? '—' : '';
  const canVoid = e.status === 'recorded' && hasPermission(session.permissions, 'finance.entries.manage');

  return (
    <section className="page">
      <Link to="/finance" className="back-link">{tr('← Expenses')}</Link>
      <div className="page-head">
        <h1 className="mono">{e.number}</h1>
        <PaymentStatus status={e.status} />
      </div>
      {voiding.message && <p className={voiding.message.ok ? 'notice' : 'error notice'}>{voiding.message.text}</p>}
      <dl className="facts">
        <div><dt>{tr('Amount')}</dt><dd className="amount">{money(e.amountMinor, e.currency)}</dd></div>
        <div><dt>{tr('Date')}</dt><dd>{formatDay(e.date, session.org)}</dd></div>
        <div><dt>{tr('Category')}</dt><dd>{category}</dd></div>
        {supplier && <div><dt>{tr('Supplier')}</dt><dd>{supplier}</dd></div>}
        {e.note && <div><dt>{tr('Note')}</dt><dd>{e.note}</dd></div>}
      </dl>
      {canVoid && <div className="form-actions"><ConfirmButton label={tr('Void expense')} confirmLabel={tr('Yes, void it')} question={tr('Void this expense? It can not be undone.')} disabled={voiding.busy} onConfirm={() => voiding.run(e.number)} /></div>}
      {e.status === 'recorded' && <PaymentsAgainst field="expenseId" id={e.id} totalMinor={e.amountMinor} currency={e.currency} />}
      <RecordHistory key={e.id} id={e.id} />
    </section>
  );
}

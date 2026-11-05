import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';
import { type AgeBucket, ageBucket, daysOverdue, todayUtc } from './ageing';

// Expenses and payments (sql/024). Owner/admin only: the permissions below are not granted to members, and the tables
// return nothing to them anyway. Every change goes through a database function that checks, changes and audits in one step.
export const financeRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const METHODS = ['cash', 'bank', 'card', 'cheque', 'other'];
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const idParam = (c: Context<AppEnv>) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};
const minor = (x: unknown) => {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 ? n : null;
};

financeRoutes.get('/categories', requirePermission('finance.reports.view'), async (c) => {
  const { data, error } = await userDb(c).from('fin_categories').select('id, name').eq('org_id', orgOf(c)).order('name');
  if (error) throw error;
  return ok(c, data);
});

financeRoutes.post('/categories', requirePermission('finance.entries.manage'), async (c) => {
  const name = text((await jsonBody(c)).name);
  if (!name) invalid('A category name is required');
  const id = await callRpc<string>(userDb(c), 'fin_create_category', { p_name: name });
  return ok(c, { id, name }, 201);
});

financeRoutes.get('/expenses', requirePermission('finance.reports.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('fin_expenses')
    .select('id, number, expense_date, category_id, supplier_id, amount_minor, currency, note, status, created_at')
    .eq('org_id', orgOf(c))
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return ok(
    c,
    (data ?? []).map((e) => ({
      id: e.id,
      number: e.number,
      date: e.expense_date,
      categoryId: e.category_id,
      supplierId: e.supplier_id,
      amountMinor: Number(e.amount_minor),
      currency: e.currency,
      note: e.note,
      status: e.status,
      createdAt: e.created_at,
    })),
  );
});

financeRoutes.post('/expenses', requirePermission('finance.entries.manage'), async (c) => {
  const b = await jsonBody(c);
  const date = text(b.date);
  const categoryId = text(b.categoryId);
  const supplierId = text(b.supplierId);
  const amount = minor(b.amountMinor);
  if (!DATE_RE.test(date) || !UUID_RE.test(categoryId) || amount === null || (supplierId && !UUID_RE.test(supplierId)))
    invalid('A date, a category and an amount above zero are required');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'fin_record_expense', {
    p_date: date,
    p_category_id: categoryId,
    p_amount_minor: amount,
    p_supplier_id: supplierId || null,
    p_note: text(b.note) || null,
  });
  return ok(c, made, 201);
});

financeRoutes.post('/expenses/:id/void', requirePermission('finance.entries.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'fin_void_expense', { p_expense_id: id });
  return ok(c, { id, status: 'void' });
});

// ---- reading payments and balances (audit 2026-11-03, finding 1) ----
// The lists show the newest rows only, so nothing that adds up money may be computed from them in the browser. Balances (what is
// still outstanding on an invoice or expense) are computed here across ALL rows, reading in pages of 1000 (PostgREST's row cap).

type PaymentRow = {
  id: string;
  number: string;
  direction: string;
  amount_minor: number;
  currency: string;
  paid_on: string;
  method: string;
  customer_invoice_id: string | null;
  supplier_invoice_id: string | null;
  expense_id: string | null;
  note: string | null;
  status: string;
  created_at: string;
};
const PAYMENT_COLS =
  'id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, supplier_invoice_id, expense_id, note, status, created_at';

/** Every row a query returns, page by page. `page(from, to)` must apply `.range(from, to)` to an ordered query. */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** id -> number for the invoices and expenses the given payments point at (so older ones are not shown as blank). */
async function targetNumbers(c: Context<AppEnv>, rows: PaymentRow[]): Promise<Map<string, string>> {
  const numbers = new Map<string, string>();
  const groups: [string, string[]][] = [
    ['sal_invoices', [...new Set(rows.map((r) => r.customer_invoice_id).filter((x): x is string => !!x))]],
    ['pur_supplier_invoices', [...new Set(rows.map((r) => r.supplier_invoice_id).filter((x): x is string => !!x))]],
    ['fin_expenses', [...new Set(rows.map((r) => r.expense_id).filter((x): x is string => !!x))]],
  ];
  for (const [table, ids] of groups) {
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await userDb(c)
        .from(table)
        .select('id, number')
        .eq('org_id', orgOf(c))
        .in('id', ids.slice(i, i + 150));
      if (error) throw error;
      for (const r of (data ?? []) as { id: string; number: string }[]) numbers.set(r.id, r.number);
    }
  }
  return numbers;
}

function shapePayment(p: PaymentRow, numbers: Map<string, string>) {
  const target = p.customer_invoice_id ?? p.supplier_invoice_id ?? p.expense_id;
  return {
    id: p.id,
    number: p.number,
    direction: p.direction,
    amountMinor: Number(p.amount_minor),
    currency: p.currency,
    paidOn: p.paid_on,
    method: p.method,
    customerInvoiceId: p.customer_invoice_id,
    supplierInvoiceId: p.supplier_invoice_id,
    expenseId: p.expense_id,
    targetNumber: target ? (numbers.get(target) ?? null) : null,
    note: p.note,
    status: p.status,
    createdAt: p.created_at,
  };
}

// The newest 300 payments, or, with ?for=c:<id> | s:<id> | e:<id>, every payment against that one invoice or expense.
financeRoutes.get('/payments', requirePermission('finance.reports.view'), async (c) => {
  const forParam = c.req.query('for') ?? '';
  const m = /^([cse]):([0-9a-f-]{36})$/i.exec(forParam);
  if (forParam && (!m || !UUID_RE.test(m[2]!))) invalid('for must be c:<id>, s:<id> or e:<id>');
  const column = m
    ? ({ c: 'customer_invoice_id', s: 'supplier_invoice_id', e: 'expense_id' } as const)[m[1]!.toLowerCase() as 'c' | 's' | 'e']
    : null;
  const base = () => userDb(c).from('fin_payments').select(PAYMENT_COLS).eq('org_id', orgOf(c));
  const rows = column
    ? await fetchAll<PaymentRow>((from, to) => base().eq(column, m![2]!).order('paid_on', { ascending: false }).order('id').range(from, to))
    : await (async () => {
        const { data, error } = await base().order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(300);
        if (error) throw error;
        return (data ?? []) as PaymentRow[];
      })();
  const numbers = await targetNumbers(c, rows);
  return ok(
    c,
    rows.map((p) => shapePayment(p, numbers)),
  );
});

financeRoutes.get('/payments/:id', requirePermission('finance.reports.view'), async (c) => {
  const id = idParam(c);
  const { data, error } = await userDb(c).from('fin_payments').select(PAYMENT_COLS).eq('org_id', orgOf(c)).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Payment not found', 'not_found');
  const row = data as PaymentRow;
  return ok(c, shapePayment(row, await targetNumbers(c, [row])));
});

financeRoutes.get('/expenses/:id', requirePermission('finance.reports.view'), async (c) => {
  const id = idParam(c);
  const { data: e, error } = await userDb(c)
    .from('fin_expenses')
    .select('id, number, expense_date, category_id, supplier_id, amount_minor, currency, note, status, created_at')
    .eq('org_id', orgOf(c))
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!e) throw new HttpError(404, 'Expense not found', 'not_found');
  return ok(c, {
    id: e.id,
    number: e.number,
    date: e.expense_date,
    categoryId: e.category_id,
    supplierId: e.supplier_id,
    amountMinor: Number(e.amount_minor),
    currency: e.currency,
    note: e.note,
    status: e.status,
    createdAt: e.created_at,
  });
});

// Everything still owed, with its outstanding balance computed over all payments: customer invoices (direction=in), or supplier
// invoices and expenses (direction=out). The payment form offers exactly these, so an old unpaid invoice can always be paid.
financeRoutes.get('/open-items', requirePermission('finance.reports.view'), async (c) => {
  const direction = c.req.query('direction') === 'out' ? 'out' : 'in';
  const org = orgOf(c);
  const db = () => userDb(c);
  const payments = await fetchAll<{
    customer_invoice_id: string | null;
    supplier_invoice_id: string | null;
    expense_id: string | null;
    amount_minor: number;
  }>((from, to) =>
    db()
      .from('fin_payments')
      .select('customer_invoice_id, supplier_invoice_id, expense_id, amount_minor')
      .eq('org_id', org)
      .eq('status', 'recorded')
      .eq('direction', direction)
      .order('id')
      .range(from, to),
  );
  const paid = new Map<string, number>();
  for (const p of payments) {
    const k = p.customer_invoice_id ?? p.supplier_invoice_id ?? p.expense_id;
    if (k) paid.set(k, (paid.get(k) ?? 0) + Number(p.amount_minor));
  }
  type Item = {
    value: string;
    kind: 'customer_invoice' | 'supplier_invoice' | 'expense';
    id: string;
    number: string;
    partyId: string | null;
    currency: string;
    totalMinor: number;
    paidMinor: number;
    leftMinor: number;
    /** sql/041. Expenses are due on their date. */
    dueDate: string;
    daysOverdue: number;
    ageBucket: AgeBucket;
  };
  const today = todayUtc();
  const items: Item[] = [];
  const push = (
    kind: Item['kind'],
    prefix: string,
    id: string,
    number: string,
    partyId: string | null,
    currency: string,
    total: number,
    dueDate: string,
  ) => {
    const done = paid.get(id) ?? 0;
    const late = daysOverdue(dueDate, today);
    if (total - done > 0)
      items.push({
        value: `${prefix}:${id}`,
        kind,
        id,
        number,
        partyId,
        currency,
        totalMinor: total,
        paidMinor: done,
        leftMinor: total - done,
        dueDate,
        daysOverdue: Math.max(0, late),
        ageBucket: ageBucket(late),
      });
  };
  if (direction === 'in') {
    const invoices = await fetchAll<{ id: string; number: string; customer_id: string; currency: string; due_date: string }>((from, to) =>
      db()
        .from('sal_invoices')
        .select('id, number, customer_id, currency, due_date')
        .eq('org_id', org)
        .eq('status', 'issued')
        .order('id')
        .range(from, to),
    );
    const lines = await fetchAll<{ invoice_id: string; qty: number; unit_price_minor: number }>((from, to) =>
      db()
        .from('sal_invoice_lines')
        .select('invoice_id, qty, unit_price_minor')
        .eq('org_id', org)
        .order('invoice_id')
        .order('order_line_id')
        .range(from, to),
    );
    const total = new Map<string, number>();
    for (const l of lines) total.set(l.invoice_id, (total.get(l.invoice_id) ?? 0) + Math.round(Number(l.qty) * Number(l.unit_price_minor)));
    for (const i of invoices) push('customer_invoice', 'c', i.id, i.number, i.customer_id, i.currency, total.get(i.id) ?? 0, i.due_date);
  } else {
    const invoices = await fetchAll<{ id: string; number: string; supplier_id: string; currency: string; due_date: string }>((from, to) =>
      db()
        .from('pur_supplier_invoices')
        .select('id, number, supplier_id, currency, due_date')
        .eq('org_id', org)
        .order('id')
        .range(from, to),
    );
    const lines = await fetchAll<{ invoice_id: string; qty: number; unit_cost_minor: number }>((from, to) =>
      db()
        .from('pur_supplier_invoice_lines')
        .select('invoice_id, qty, unit_cost_minor')
        .eq('org_id', org)
        .order('invoice_id')
        .order('order_line_id')
        .range(from, to),
    );
    const total = new Map<string, number>();
    for (const l of lines) total.set(l.invoice_id, (total.get(l.invoice_id) ?? 0) + Number(l.qty) * Number(l.unit_cost_minor));
    for (const i of invoices) push('supplier_invoice', 's', i.id, i.number, i.supplier_id, i.currency, total.get(i.id) ?? 0, i.due_date);
    const expenses = await fetchAll<{
      id: string;
      number: string;
      supplier_id: string | null;
      currency: string;
      amount_minor: number;
      expense_date: string;
    }>((from, to) =>
      db()
        .from('fin_expenses')
        .select('id, number, supplier_id, currency, amount_minor, expense_date')
        .eq('org_id', org)
        .eq('status', 'recorded')
        .order('id')
        .range(from, to),
    );
    for (const e of expenses) push('expense', 'e', e.id, e.number, e.supplier_id, e.currency, Number(e.amount_minor), e.expense_date);
  }
  items.sort((a, b) => b.number.localeCompare(a.number));
  return ok(c, items);
});

financeRoutes.post('/payments', requirePermission('finance.entries.manage'), async (c) => {
  const b = await jsonBody(c);
  const direction = text(b.direction);
  const amount = minor(b.amountMinor);
  const paidOn = text(b.paidOn);
  const method = text(b.method);
  const ids = { customer: text(b.customerInvoiceId), supplier: text(b.supplierInvoiceId), expense: text(b.expenseId) };
  if ((direction !== 'in' && direction !== 'out') || amount === null || !DATE_RE.test(paidOn) || !METHODS.includes(method))
    invalid('Direction, an amount above zero, a date and a method are required');
  for (const v of Object.values(ids)) if (v && !UUID_RE.test(v)) invalid('Invalid reference');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'fin_record_payment', {
    p_direction: direction,
    p_amount_minor: amount,
    p_paid_on: paidOn,
    p_method: method,
    p_customer_invoice_id: ids.customer || null,
    p_supplier_invoice_id: ids.supplier || null,
    p_expense_id: ids.expense || null,
    p_note: text(b.note) || null,
  });
  return ok(c, made, 201);
});

financeRoutes.post('/payments/:id/void', requirePermission('finance.entries.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'fin_void_payment', { p_payment_id: id });
  return ok(c, { id, status: 'void' });
});

// The owner home numbers (sql/027): read-only, computed in the database, owner/admin only.
financeRoutes.get('/insights', requirePermission('finance.reports.view'), async (c) => {
  return ok(c, await callRpc<Record<string, unknown>>(userDb(c), 'insights_home', {}));
});

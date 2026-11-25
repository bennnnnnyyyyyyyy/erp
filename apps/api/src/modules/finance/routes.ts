import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { ISO_DAY, MAX_MINOR, invalid, jsonBody, textUpTo } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { pageRange } from '../../lib/paging';
import { idsMatching, orFilter, searchText } from '../../lib/search';
import { HttpError, isMissingSchema } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { parsePurchaseVat } from '../../lib/vatRows';
import { requirePermission } from '../../middleware/tenant';
import type { ItemStatementLine, PartyStatementLine, VatSummary } from '@erp/shared';
import { csvResponse, minorToText } from '../../lib/csv';
import { attachProviderAddress, type LinkInfo, type Payer } from '../../lib/payments/links';
import { type AgeBucket, ageBucket, daysOverdue, todayUtc } from './ageing';

// Expenses and payments (sql/024). Owner/admin only: the permissions below are not granted to members, and the tables
// return nothing to them anyway. Every change goes through a database function that checks, changes and audits in one step.
export const financeRoutes = new Hono<AppEnv>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = ISO_DAY; // a real day, years 1900-2100 (lib/body.ts)
const METHODS = ['cash', 'bank', 'card', 'cheque', 'other'];
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const idParam = (c: Context<AppEnv>) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};
// Whole minor units above 0, at most MAX_MINOR (10 billion in a two-decimal currency; input audit, 25 Nov 2026).
const minor = (x: unknown) => {
  const n = Number(x);
  return Number.isInteger(n) && n > 0 && n <= MAX_MINOR ? n : null;
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
  // '*' so the list also answers before sql/087 (then: no VAT).
  // ?q= searches on the server: number, note, supplier or category name (lib/search.ts; Ben, 25 Nov 2026).
  const q = searchText(c);
  let query = userDb(c).from('fin_expenses').select('*').eq('org_id', orgOf(c));
  if (q) {
    const [suppliers, categories] = await Promise.all([
      idsMatching(userDb(c), 'pur_suppliers', 'name', orgOf(c), q),
      idsMatching(userDb(c), 'fin_categories', 'name', orgOf(c), q),
    ]);
    query = query.or(
      orFilter(
        q,
        ['number', 'note'],
        [
          ['supplier_id', suppliers],
          ['category_id', categories],
        ],
      ),
    );
  }
  const { data, error } = await query
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id')
    .range(...pageRange(c, 300));
  if (error) throw error;
  return ok(
    c,
    (data ?? []).map((e) => ({
      id: e.id,
      number: e.number,
      date: e.expense_date,
      categoryId: e.category_id,
      supplierId: e.supplier_id,
      /** The total paid, VAT included. */
      amountMinor: Number(e.amount_minor),
      ...expenseVat(e),
      currency: e.currency,
      note: e.note,
      status: e.status,
      createdAt: e.created_at,
    })),
  );
});

/** An expense's VAT (sql/087), or none for a row read before that migration. */
function expenseVat(e: Record<string, unknown>) {
  const amount = Number(e.amount_minor);
  const tax = e.tax_minor === undefined || e.tax_minor === null ? 0 : Number(e.tax_minor);
  return {
    netMinor: e.net_minor === undefined || e.net_minor === null ? amount - tax : Number(e.net_minor),
    taxMinor: tax,
    vatDeductible: e.vat_deductible === true,
    vatClass: typeof e.vat_class === 'string' ? e.vat_class : 'local',
    vatDocumentRef: typeof e.vat_document_ref === 'string' ? e.vat_document_ref : null,
    supplierTaxNumber: typeof e.supplier_tax_number === 'string' ? e.supplier_tax_number : null,
  };
}

financeRoutes.post('/expenses', requirePermission('finance.entries.manage'), async (c) => {
  const b = await jsonBody(c);
  const date = text(b.date);
  const categoryId = text(b.categoryId);
  const supplierId = text(b.supplierId);
  const amount = minor(b.amountMinor);
  if (!DATE_RE.test(date) || !UUID_RE.test(categoryId) || amount === null || (supplierId && !UUID_RE.test(supplierId)))
    invalid('A date, a category and an amount above zero are required');
  // Optional VAT as printed on the receipt (sql/087); the amount stays the total paid.
  const vat = parsePurchaseVat(b.vat);
  if (vat?.taxMinor !== undefined && vat.taxMinor >= amount) invalid('The VAT must be below the total');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'fin_record_expense', {
    p_date: date,
    p_category_id: categoryId,
    p_amount_minor: amount,
    p_supplier_id: supplierId || null,
    p_note: textUpTo(b.note, 500, 'Note'),
    // only sent when given, so the call also works against a database without sql/087
    ...(vat ? { p_vat: vat } : {}),
  });
  return ok(c, made, 201);
});

// VAT summary for a period (sql/089, VAT plan part 3), laid out like the return. Owners and admins (the database checks again).
// ?format=csv: the summary lines, the totals, then every document behind them.
financeRoutes.get('/vat-summary', requirePermission('finance.reports.view'), async (c) => {
  const from = text(c.req.query('from'));
  const to = text(c.req.query('to'));
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) invalid('from and to must be YYYY-MM-DD');
  const s = await callRpc<VatSummary>(userDb(c), 'fin_vat_summary', { p_from: from, p_to: to });
  if (c.req.query('format') !== 'csv') return ok(c, s);
  const m = (v: number) => minorToText(v, s.currency);
  const rows: (string | number | null)[][] = [
    ...s.sales.map((r) => ['sales', r.kind, r.rate, m(r.netMinor), m(r.taxMinor), '', m(r.invoicesNetMinor), m(r.notesNetMinor)]),
    ...s.purchases.map((r) => ['purchases', r.kind, '', m(r.netMinor), m(r.deductibleTaxMinor), m(r.nonDeductibleTaxMinor), '', '']),
    ['total', 'output_vat', '', '', m(s.outputTaxMinor), '', '', ''],
    ['total', 'input_vat_deductible', '', '', m(s.inputTaxMinor), '', '', ''],
    ['total', s.dueMinor >= 0 ? 'vat_due' : 'vat_credit', '', '', m(Math.abs(s.dueMinor)), '', '', ''],
    ...s.warnings.map((w) => ['warning', w, '', '', '', '', '', '']),
    ...s.documents.map((d) => [
      `document:${d.type}`,
      `${d.side}:${d.kind}`,
      d.rate,
      m(d.netMinor),
      m(d.taxMinor),
      m(d.nonDeductibleTaxMinor),
      d.number,
      d.date,
    ]),
  ];
  return csvResponse(
    c,
    `vat-summary-${from}-to-${to}.csv`,
    ['section', 'kind', 'rate', 'net', 'vat', 'vat_not_deductible', 'detail', 'detail2'],
    rows,
  );
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
        // ?q= searches on the server: the payment number or its note (lib/search.ts; Ben, 25 Nov 2026).
        const q = searchText(c);
        const searched = q ? base().or(orFilter(q, ['number', 'note'])) : base();
        const { data, error } = await searched
          .order('paid_on', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id')
          .range(...pageRange(c, 300));
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
  const { data: e, error } = await userDb(c).from('fin_expenses').select('*').eq('org_id', orgOf(c)).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!e) throw new HttpError(404, 'Expense not found', 'not_found');
  return ok(c, {
    id: e.id,
    number: e.number,
    date: e.expense_date,
    categoryId: e.category_id,
    supplierId: e.supplier_id,
    amountMinor: Number(e.amount_minor),
    ...expenseVat(e),
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
    /** For expenses: category and note, so unpaid expenses can be told apart in the payment list (decision D7, 9 Nov 2026). */
    detail?: string;
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
    // '*': the stored gross (sql/086) when the database has it, else the old sum of the lines (code shipped before the migration).
    const invoices = await fetchAll<{
      id: string;
      number: string;
      customer_id: string;
      currency: string;
      due_date: string;
      gross_minor?: number | null;
    }>((from, to) => db().from('sal_invoices').select('*').eq('org_id', org).eq('status', 'issued').order('id').range(from, to));
    const total = new Map<string, number>();
    if (invoices.some((i) => i.gross_minor === undefined || i.gross_minor === null)) {
      const lines = await fetchAll<{ invoice_id: string; qty: number; unit_price_minor: number }>((from, to) =>
        db()
          .from('sal_invoice_lines')
          .select('invoice_id, qty, unit_price_minor')
          .eq('org_id', org)
          .order('invoice_id')
          .order('order_line_id')
          .range(from, to),
      );
      for (const l of lines)
        total.set(l.invoice_id, (total.get(l.invoice_id) ?? 0) + Math.round(Number(l.qty) * Number(l.unit_price_minor)));
    } else {
      for (const i of invoices) total.set(i.id, Number(i.gross_minor));
    }
    // Approved credit notes lower what is owed and debit notes raise it (VAT plan section 6; the database check does the same).
    const notes = await fetchAll<{ invoice_id: string; kind: string; total_minor: number }>((from, to) =>
      db().from('sal_notes').select('invoice_id, kind, total_minor').eq('org_id', org).eq('status', 'approved').order('id').range(from, to),
    );
    for (const n of notes) {
      if (!total.has(n.invoice_id)) continue;
      total.set(n.invoice_id, (total.get(n.invoice_id) ?? 0) + (n.kind === 'credit' ? -1 : 1) * Number(n.total_minor));
    }
    for (const i of invoices) push('customer_invoice', 'c', i.id, i.number, i.customer_id, i.currency, total.get(i.id) ?? 0, i.due_date);
  } else {
    // '*': the stored gross (sql/087, VAT as printed) when the database has it, else the sum of the lines.
    const invoices = await fetchAll<{
      id: string;
      number: string;
      supplier_id: string;
      currency: string;
      due_date: string;
      gross_minor?: number | null;
    }>((from, to) => db().from('pur_supplier_invoices').select('*').eq('org_id', org).order('id').range(from, to));
    const total = new Map<string, number>();
    if (invoices.some((i) => i.gross_minor === undefined || i.gross_minor === null)) {
      const lines = await fetchAll<{ invoice_id: string; qty: number; unit_cost_minor: number }>((from, to) =>
        db()
          .from('pur_supplier_invoice_lines')
          .select('invoice_id, qty, unit_cost_minor')
          .eq('org_id', org)
          .order('invoice_id')
          .order('order_line_id')
          .range(from, to),
      );
      for (const l of lines)
        total.set(l.invoice_id, (total.get(l.invoice_id) ?? 0) + Math.round(Number(l.qty) * Number(l.unit_cost_minor)));
    } else {
      for (const i of invoices) total.set(i.id, Number(i.gross_minor));
    }
    // Approved supplier credit notes lower what is owed on a bill, debit notes raise it (sql/094). Before that migration: no table, no notes.
    const supplierNotes = await fetchAll<{ bill_id: string; kind: string; gross_minor: number }>((from, to) =>
      db().from('pur_notes').select('bill_id, kind, gross_minor').eq('org_id', org).eq('status', 'approved').order('id').range(from, to),
    ).catch((e: unknown) => {
      if (isMissingSchema(e)) return [] as { bill_id: string; kind: string; gross_minor: number }[];
      throw e;
    });
    for (const sn of supplierNotes) {
      if (!total.has(sn.bill_id)) continue;
      total.set(sn.bill_id, (total.get(sn.bill_id) ?? 0) + (sn.kind === 'credit' ? -1 : 1) * Number(sn.gross_minor));
    }
    for (const i of invoices) push('supplier_invoice', 's', i.id, i.number, i.supplier_id, i.currency, total.get(i.id) ?? 0, i.due_date);
    const expenses = await fetchAll<{
      id: string;
      number: string;
      supplier_id: string | null;
      currency: string;
      amount_minor: number;
      expense_date: string;
      category_id: string;
      note: string | null;
    }>((from, to) =>
      db()
        .from('fin_expenses')
        .select('id, number, supplier_id, currency, amount_minor, expense_date, category_id, note')
        .eq('org_id', org)
        .eq('status', 'recorded')
        .order('id')
        .range(from, to),
    );
    const { data: cats } = await db().from('fin_categories').select('id, name').eq('org_id', org);
    const catName = new Map(((cats ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
    for (const e of expenses) {
      const before = items.length;
      push('expense', 'e', e.id, e.number, e.supplier_id, e.currency, Number(e.amount_minor), e.expense_date);
      const added = items[before];
      if (added) added.detail = [catName.get(e.category_id) ?? '', e.note ?? ''].filter(Boolean).join(' · ');
    }
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
  // sql/051: the cash box or bank account the money went through (required by the database for cash and bank once treasury is on).
  const treasuryAccountId = text(b.treasuryAccountId);
  if (treasuryAccountId && !UUID_RE.test(treasuryAccountId)) invalid('Invalid treasury account');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'fin_record_payment', {
    p_direction: direction,
    p_amount_minor: amount,
    p_paid_on: paidOn,
    p_method: method,
    p_customer_invoice_id: ids.customer || null,
    p_supplier_invoice_id: ids.supplier || null,
    p_expense_id: ids.expense || null,
    p_note: textUpTo(b.note, 500, 'Note'),
    p_treasury_account_id: treasuryAccountId || null,
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

// ---- statements of account (كشف حساب; TREASURY_PLAN.md S1, sql/052). Read-only, computed in the database. ?format=csv downloads.

const statementPeriod = (c: Context<AppEnv>) => {
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) invalid('from and to are required (YYYY-MM-DD), with to on or after from');
  return { from, to };
};

financeRoutes.get('/statements/party', requirePermission('finance.statements.view'), async (c) => {
  const type = c.req.query('type') ?? '';
  const id = c.req.query('id') ?? '';
  const currency = (c.req.query('currency') ?? '').toUpperCase() || c.var.tenant.defaultCurrency;
  if ((type !== 'customer' && type !== 'supplier') || !UUID_RE.test(id)) invalid('type (customer or supplier) and id are required');
  if (!/^[A-Z]{3}$/.test(currency)) invalid('currency must be a three-letter code');
  const p = statementPeriod(c);
  const rows = await callRpc<
    {
      line_id: number | null;
      entry_id: string | null;
      entry_number: string | null;
      entry_date: string;
      source_type: string | null;
      source_id: string | null;
      event: string | null;
      memo: string | null;
      account_code: string | null;
      debit_minor: number;
      credit_minor: number;
      balance_minor: number;
      is_opening: boolean;
    }[]
  >(userDb(c), 'acc_party_statement', { p_party_type: type, p_party_id: id, p_from: p.from, p_to: p.to, p_currency: currency });
  const lines: PartyStatementLine[] = (rows ?? []).map((r) => ({
    isOpening: r.is_opening,
    lineId: r.line_id === null ? null : Number(r.line_id),
    entryId: r.entry_id,
    entryNumber: r.entry_number,
    entryDate: r.entry_date,
    sourceType: r.source_type,
    sourceId: r.source_id,
    event: r.event,
    memo: r.memo,
    accountCode: r.account_code,
    debitMinor: Number(r.debit_minor),
    creditMinor: Number(r.credit_minor),
    balanceMinor: Number(r.balance_minor),
  }));
  if (c.req.query('format') !== 'csv') return ok(c, { currency, lines });
  return csvResponse(
    c,
    `statement-${type}-${p.from}-to-${p.to}.csv`,
    ['date', 'entry', 'description', 'debit', 'credit', 'balance', 'currency'],
    lines.map((l) => [
      l.entryDate,
      l.entryNumber,
      l.isOpening ? 'Opening balance' : l.memo,
      minorToText(l.debitMinor, currency),
      minorToText(l.creditMinor, currency),
      minorToText(l.balanceMinor, currency),
      currency,
    ]),
  );
});

financeRoutes.get('/statements/item', requirePermission('finance.statements.view'), async (c) => {
  const itemId = c.req.query('itemId') ?? '';
  const warehouseId = c.req.query('warehouseId') ?? '';
  if (!UUID_RE.test(itemId) || (warehouseId && !UUID_RE.test(warehouseId))) invalid('itemId is required');
  const p = statementPeriod(c);
  const rows = await callRpc<
    {
      move_id: number | null;
      move_date: string;
      kind: string;
      ref: string | null;
      warehouse_id: string | null;
      qty_in: number | null;
      qty_out: number | null;
      unit_cost_minor: number | null;
      value_minor: number | null;
      cost_known: boolean;
      balance_qty: number;
      balance_value_minor: number;
      is_opening: boolean;
    }[]
  >(userDb(c), 'inv_item_statement', { p_item_id: itemId, p_from: p.from, p_to: p.to, p_warehouse_id: warehouseId || null });
  const n = (x: number | null) => (x === null ? null : Number(x));
  const lines: ItemStatementLine[] = (rows ?? []).map((r) => ({
    isOpening: r.is_opening,
    moveId: n(r.move_id),
    moveDate: r.move_date,
    kind: r.kind,
    ref: r.ref,
    warehouseId: r.warehouse_id,
    qtyIn: n(r.qty_in),
    qtyOut: n(r.qty_out),
    unitCostMinor: n(r.unit_cost_minor),
    valueMinor: n(r.value_minor),
    costKnown: r.cost_known,
    balanceQty: Number(r.balance_qty),
    balanceValueMinor: Number(r.balance_value_minor),
  }));
  const currency = c.var.tenant.defaultCurrency;
  if (c.req.query('format') !== 'csv') return ok(c, { currency, lines });
  return csvResponse(
    c,
    `item-statement-${p.from}-to-${p.to}.csv`,
    ['date', 'kind', 'reference', 'in', 'out', 'unit_cost', 'value', 'balance_qty', 'balance_value', 'currency'],
    lines.map((l) => [
      l.moveDate,
      l.kind,
      l.ref,
      l.qtyIn,
      l.qtyOut,
      l.unitCostMinor === null ? null : minorToText(l.unitCostMinor, currency),
      l.valueMinor === null ? null : minorToText(l.valueMinor, currency),
      l.balanceQty,
      minorToText(l.balanceValueMinor, currency),
      currency,
    ]),
  );
});

// ---- "Pay now" links (sql/057; Paymob and Fawry). Owner and admin. The provider's signed callback records the payment, never the browser.
const LINK_COLS =
  'id, invoice_id, provider, provider_ref, amount_minor, currency, status, simulated, url, provider_txn, review_reason, payment_id, created_at, paid_at';

financeRoutes.get('/payment-links', requirePermission('finance.reports.view'), async (c) => {
  const invoice = c.req.query('invoiceId') ?? '';
  if (invoice && !UUID_RE.test(invoice)) invalid('Invalid invoice');
  let q = userDb(c).from('fin_payment_links').select(LINK_COLS).eq('org_id', orgOf(c)).order('created_at', { ascending: false }).limit(100);
  if (invoice) q = q.eq('invoice_id', invoice);
  const { data, error } = await q;
  if (error) throw error;
  return ok(c, data ?? []);
});

financeRoutes.post('/payment-links', requirePermission('finance.entries.manage'), async (c) => {
  const b = await jsonBody(c);
  const invoiceId = text(b.invoiceId);
  const provider = text(b.provider);
  const amount = b.amountMinor === undefined || b.amountMinor === null ? null : minor(b.amountMinor);
  if (
    !UUID_RE.test(invoiceId) ||
    (provider !== 'paymob' && provider !== 'fawry') ||
    (b.amountMinor !== undefined && b.amountMinor !== null && amount === null)
  )
    invalid('An invoice, a provider (paymob or fawry) and, optionally, an amount above zero are required');
  const db = userDb(c);
  const link = await callRpc<LinkInfo>(db, 'fin_create_payment_link', {
    p_invoice_id: invoiceId,
    p_provider: provider,
    p_amount_minor: amount,
  });
  // sql/082 removed test mode; a test-mode link can only appear while 082 is not applied yet on this database.
  if (link.simulated) {
    await callRpc<void>(db, 'fin_payment_link_fail', { p_link_id: link.id, p_reason: 'test mode' }).catch(() => undefined);
    throw new HttpError(503, 'Payment links are being updated. Try again after the database update (sql/082).', 'not_set_up');
  }
  const { data: inv } = await db.from('sal_invoices').select('customer_id').eq('org_id', orgOf(c)).eq('id', invoiceId).maybeSingle();
  const { data: cust } = inv
    ? await db
        .from('sal_customers')
        .select('name, contact, phone')
        .eq('org_id', orgOf(c))
        .eq('id', (inv as { customer_id: string }).customer_id)
        .maybeSingle()
    : { data: null };
  const cu = (cust ?? {}) as { name?: string; contact?: string | null; phone?: string | null };
  const payer: Payer = {
    name: cu.name ?? 'Customer',
    phone: cu.phone ?? null,
    email: cu.contact && cu.contact.includes('@') ? cu.contact : null,
  };
  try {
    const where = await attachProviderAddress(c.env, db, provider, link, payer, new URL(c.req.url).origin);
    return ok(c, { ...link, ...where }, 201);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'The provider could not be reached';
    await callRpc<void>(db, 'fin_payment_link_fail', { p_link_id: link.id, p_reason: reason }).catch(() => undefined);
    throw new HttpError(502, reason, 'provider_error');
  }
});

financeRoutes.post('/payment-links/:id/cancel', requirePermission('finance.entries.manage'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'fin_cancel_payment_link', { p_link_id: id });
  return ok(c, { id, status: 'cancelled' });
});

// Sales by product (UX audit 20 Nov, phase 0: the home "Top products" tile opened the invoice list). The same rule as the tile in
// fin_owner_insights (sql/027 onward): issued invoices dated in the last `days` days, revenue = round(qty x unit price) before VAT,
// grouped by item. Every item, ranked by revenue, with quantity and share of the total. Read with the person's own sign-in (RLS).
financeRoutes.get('/product-sales', requirePermission('finance.reports.view'), async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 90) || 90, 1), 3660);
  const org = orgOf(c);
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const invoices = await fetchAll<{ id: string }>((from, to) =>
    userDb(c)
      .from('sal_invoices')
      .select('id')
      .eq('org_id', org)
      .eq('status', 'issued')
      .gte('invoice_date', since)
      .order('id')
      .range(from, to),
  );
  const byItem = new Map<string, { qty: number; revenueMinor: number }>();
  const ids = invoices.map((i) => i.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const lines = await fetchAll<{ order_line_id: string; qty: number; unit_price_minor: number }>((from, to) =>
      userDb(c)
        .from('sal_invoice_lines')
        .select('order_line_id, qty, unit_price_minor')
        .eq('org_id', org)
        .in('invoice_id', chunk)
        .order('id')
        .range(from, to),
    );
    const orderLineIds = [...new Set(lines.map((l) => l.order_line_id))];
    const itemOf = new Map<string, string>();
    for (let j = 0; j < orderLineIds.length; j += 200) {
      const { data, error } = await userDb(c)
        .from('sal_order_lines')
        .select('id, item_id')
        .eq('org_id', org)
        .in('id', orderLineIds.slice(j, j + 200));
      if (error) throw error;
      for (const r of (data ?? []) as { id: string; item_id: string }[]) itemOf.set(r.id, r.item_id);
    }
    for (const l of lines) {
      const itemId = itemOf.get(l.order_line_id);
      if (!itemId) continue;
      const row = byItem.get(itemId) ?? { qty: 0, revenueMinor: 0 };
      row.qty += Number(l.qty);
      row.revenueMinor += Math.round(Number(l.qty) * Number(l.unit_price_minor));
      byItem.set(itemId, row);
    }
  }
  const total = [...byItem.values()].reduce((n, r) => n + r.revenueMinor, 0);
  const rows = [...byItem.entries()]
    .map(([itemId, r]) => ({
      itemId,
      qty: Math.round(r.qty * 1000) / 1000,
      revenueMinor: r.revenueMinor,
      sharePercent: total > 0 ? Math.round((1000 * r.revenueMinor) / total) / 10 : 0,
    }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor);
  return ok(c, { days, since, totalMinor: total, rows });
});

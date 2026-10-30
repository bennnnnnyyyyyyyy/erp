import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { ok } from '../../lib/response';
import { callRpc } from '../../lib/rpc';
import { requirePermission } from '../../middleware/tenant';

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
  return ok(c, (data ?? []).map((e) => ({ id: e.id, number: e.number, date: e.expense_date, categoryId: e.category_id, supplierId: e.supplier_id, amountMinor: Number(e.amount_minor), currency: e.currency, note: e.note, status: e.status, createdAt: e.created_at })));
});

financeRoutes.post('/expenses', requirePermission('finance.entries.manage'), async (c) => {
  const b = await jsonBody(c);
  const date = text(b.date);
  const categoryId = text(b.categoryId);
  const supplierId = text(b.supplierId);
  const amount = minor(b.amountMinor);
  if (!DATE_RE.test(date) || !UUID_RE.test(categoryId) || amount === null || (supplierId && !UUID_RE.test(supplierId))) invalid('A date, a category and an amount above zero are required');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'fin_record_expense', { p_date: date, p_category_id: categoryId, p_amount_minor: amount, p_supplier_id: supplierId || null, p_note: text(b.note) || null });
  return ok(c, made, 201);
});

financeRoutes.post('/expenses/:id/void', requirePermission('finance.entries.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'fin_void_expense', { p_expense_id: id });
  return ok(c, { id, status: 'void' });
});

financeRoutes.get('/payments', requirePermission('finance.reports.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('fin_payments')
    .select('id, number, direction, amount_minor, currency, paid_on, method, customer_invoice_id, supplier_invoice_id, expense_id, note, status, created_at')
    .eq('org_id', orgOf(c))
    .order('paid_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw error;
  return ok(c, (data ?? []).map((p) => ({ id: p.id, number: p.number, direction: p.direction, amountMinor: Number(p.amount_minor), currency: p.currency, paidOn: p.paid_on, method: p.method, customerInvoiceId: p.customer_invoice_id, supplierInvoiceId: p.supplier_invoice_id, expenseId: p.expense_id, note: p.note, status: p.status, createdAt: p.created_at })));
});

financeRoutes.post('/payments', requirePermission('finance.entries.manage'), async (c) => {
  const b = await jsonBody(c);
  const direction = text(b.direction);
  const amount = minor(b.amountMinor);
  const paidOn = text(b.paidOn);
  const method = text(b.method);
  const ids = { customer: text(b.customerInvoiceId), supplier: text(b.supplierInvoiceId), expense: text(b.expenseId) };
  if ((direction !== 'in' && direction !== 'out') || amount === null || !DATE_RE.test(paidOn) || !METHODS.includes(method)) invalid('Direction, an amount above zero, a date and a method are required');
  for (const v of Object.values(ids)) if (v && !UUID_RE.test(v)) invalid('Invalid reference');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'fin_record_payment', {
    p_direction: direction, p_amount_minor: amount, p_paid_on: paidOn, p_method: method,
    p_customer_invoice_id: ids.customer || null, p_supplier_invoice_id: ids.supplier || null, p_expense_id: ids.expense || null, p_note: text(b.note) || null,
  });
  return ok(c, made, 201);
});

financeRoutes.post('/payments/:id/void', requirePermission('finance.entries.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'fin_void_payment', { p_payment_id: id });
  return ok(c, { id, status: 'void' });
});

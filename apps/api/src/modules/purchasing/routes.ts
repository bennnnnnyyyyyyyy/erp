import { BANK_RULE, REGISTRY_RULE, bankAccountOk, emailOk, registryOk } from '@erp/shared';
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { MAX_MINOR, invalid, isGoodQty, isIsoDay, jsonBody, partyBasics } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { pageRange, readAllPages } from '../../lib/paging';
import { idsMatching, orFilter, searchText } from '../../lib/search';
import { HttpError, isMissingSchema } from '../../lib/errors';
import { setLineUnits } from '../../lib/lineUnits';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { registerBillScanRoutes } from './billScan';
import {
  VAT_CLASSES,
  billLineOut,
  billTotals,
  parsePurchaseVat,
  type BillLineOut,
  type BillLineRow,
  type BillRow,
} from '../../lib/vatRows';

// Orders are immutable commitments. Receipt is a single database function that posts stock and audit atomically.
export const purchasingRoutes = new Hono<AppEnv>();
registerBillScanRoutes(purchasingRoutes);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const idParam = (c: Context<AppEnv>) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};
type SupplierRow = {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  city: string | null;
  phone: string | null;
  payment_terms_days?: number | null;
  // sql/076
  tax_number?: string | null;
  commercial_registry?: string | null;
  email?: string | null;
  address?: string | null;
  bank_name?: string | null;
  bank_account?: string | null;
  default_currency?: string | null;
  notes?: string | null;
};
type OrderRow = {
  id: string;
  number: string;
  supplier_id: string;
  warehouse_id: string;
  status: 'ordered' | 'received' | 'cancelled';
  currency: string;
  created_by: string;
  created_at: string;
  received_at: string | null;
  // sql/069 (absent until it is applied)
  approval?: 'not_needed' | 'pending' | 'approved' | 'rejected';
  approval_decided_by?: string | null;
  approval_decided_at?: string | null;
  approval_note?: string | null;
  approval_self?: boolean;
  // sql/073
  promised_date?: string | null;
  supplier_ref?: string | null;
  confirmed_at?: string | null;
};
const ORDER_COLUMNS = 'id, number, supplier_id, warehouse_id, status, currency, created_by, created_at, received_at';
const APPROVAL_COLUMNS = 'approval, approval_decided_by, approval_decided_at, approval_note, approval_self';
const CONFIRM_COLUMNS = 'promised_date, supplier_ref, confirmed_at'; // sql/073
const SUPPLIER_DETAIL_COLUMNS = 'tax_number, commercial_registry, email, address, bank_name, bank_account, default_currency, notes';
const supplier = (s: SupplierRow) => ({
  id: s.id,
  code: s.code,
  name: s.name,
  contact: s.contact ?? '',
  city: s.city ?? '',
  phone: s.phone ?? '',
  /** null = the company default (sql/041). */
  paymentTermsDays: s.payment_terms_days ?? null,
  // sql/076: business details of the company, shown only to people who can read suppliers (never in public report links).
  taxNumber: s.tax_number ?? '',
  commercialRegistry: s.commercial_registry ?? '',
  email: s.email ?? '',
  address: s.address ?? '',
  bankName: s.bank_name ?? '',
  bankAccount: s.bank_account ?? '',
  defaultCurrency: s.default_currency ?? '',
  notes: s.notes ?? '',
});

/** The optional supplier details from a request body, as the database function's parameters (sql/076). Empty means none. */
function supplierDetails(body: Record<string, unknown>) {
  const limited = (v: string, max: number, label: string) => {
    if (v.length > max) invalid(`${label} is too long (up to ${max} characters)`);
    return v || null;
  };
  const email = limited(text(body.email), 200, 'Email');
  // The shared rules (packages/shared/src/fieldRules.ts), the same as the screen checks while the person types.
  if (email && !emailOk(email)) invalid('That email address is not valid');
  const currency = text(body.defaultCurrency).toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) invalid('A currency is a 3-letter code, for example EGP');
  const taxNumber = limited(text(body.taxNumber), 40, 'Tax registration number');
  if (taxNumber && !registryOk(taxNumber)) invalid(`Tax registration number: ${REGISTRY_RULE}`);
  const registry = limited(text(body.commercialRegistry), 40, 'Commercial registry number');
  if (registry && !registryOk(registry)) invalid(`Commercial registry number: ${REGISTRY_RULE}`);
  const bankAccount = limited(text(body.bankAccount), 60, 'Bank account');
  if (bankAccount && !bankAccountOk(bankAccount)) invalid(`Bank account: ${BANK_RULE}`);
  const all = {
    p_tax_number: taxNumber,
    p_commercial_registry: registry,
    p_email: email,
    p_address: limited(text(body.address), 500, 'Address'),
    p_bank_name: limited(text(body.bankName), 120, 'Bank name'),
    p_bank_account: bankAccount,
    p_default_currency: currency || null,
    p_notes: limited(text(body.notes), 2000, 'Notes'),
  };
  // Only what was given: with none, the call is the old one and works before sql/076 is applied.
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== null));
}

async function loadOrders(c: Context<AppEnv>, id?: string) {
  const read = (columns: string) => {
    let query = userDb(c)
      .from('pur_orders')
      .select(columns)
      .eq('org_id', orgOf(c))
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(...pageRange(c, 200));
    if (id) query = query.eq('id', id);
    return query;
  };
  // With the approval columns; without them while sql/069 is not applied yet, so the orders still show (memory: merged before migration).
  // Newest columns first; each fallback drops what a not-yet-applied migration adds (073, then 069).
  let { data, error } = await read(`${ORDER_COLUMNS}, ${APPROVAL_COLUMNS}, ${CONFIRM_COLUMNS}`);
  if (error && isMissingSchema(error)) ({ data, error } = await read(`${ORDER_COLUMNS}, ${APPROVAL_COLUMNS}`));
  if (error && isMissingSchema(error)) ({ data, error } = await read(ORDER_COLUMNS));
  if (error) throw error;
  const rows = (data ?? []) as unknown as OrderRow[];
  const ids = rows.map((o) => o.id);
  const lines = new Map<
    string,
    {
      lineId: string;
      itemId: string;
      qty: number;
      receivedQty: number;
      unitCostMinor: number;
      unit: string | null;
      unitFactor: number | null;
    }[]
  >();
  if (ids.length) {
    // The typed unit (sql/101); before it is applied the lines are read without it.
    const lineQuery = (cols: string) => userDb(c).from('pur_order_lines').select(cols).eq('org_id', orgOf(c)).in('order_id', ids);
    let { data: lineRows, error: lineError } = await lineQuery(
      'id, order_id, item_id, qty, received_qty, unit_cost_minor, unit, unit_factor',
    );
    if (lineError && isMissingSchema(lineError))
      ({ data: lineRows, error: lineError } = await lineQuery('id, order_id, item_id, qty, received_qty, unit_cost_minor'));
    if (lineError) throw lineError;
    for (const l of (lineRows ?? []) as unknown as {
      id: string;
      order_id: string;
      item_id: string;
      qty: number;
      received_qty: number;
      unit_cost_minor: number;
      unit?: string | null;
      unit_factor?: number | null;
    }[])
      lines.set(l.order_id, [
        ...(lines.get(l.order_id) ?? []),
        {
          lineId: l.id,
          itemId: l.item_id,
          qty: Number(l.qty),
          // sql/064: how much of the line has arrived so far.
          receivedQty: Number(l.received_qty),
          unitCostMinor: Number(l.unit_cost_minor),
          unit: l.unit ?? null,
          unitFactor: l.unit_factor == null ? null : Number(l.unit_factor),
        },
      ]);
  }
  return rows.map((o) => {
    const orderLines = lines.get(o.id) ?? [];
    return {
      id: o.id,
      number: o.number,
      supplierId: o.supplier_id,
      warehouseId: o.warehouse_id,
      status: o.status,
      currency: o.currency,
      createdBy: o.created_by,
      createdAt: o.created_at,
      receivedAt: o.received_at,
      /** sql/069: 'pending' = waiting for approval; nothing can be received until it is approved. */
      approval: o.approval ?? 'not_needed',
      approvalDecidedBy: o.approval_decided_by ?? null,
      approvalDecidedAt: o.approval_decided_at ?? null,
      approvalNote: o.approval_note ?? null,
      approvalSelf: o.approval_self ?? false,
      /** sql/073: the supplier's confirmation; an open order past promisedDate is late. */
      promisedDate: o.promised_date ?? null,
      supplierRef: o.supplier_ref ?? null,
      confirmedAt: o.confirmed_at ?? null,
      lines: orderLines,
      /** Open, with some goods already in (sql/064): the screens say "Partly received". */
      partlyReceived: o.status === 'ordered' && orderLines.some((l) => l.receivedQty > 0),
      totalMinor: orderLines.reduce((sum, l) => sum + l.qty * l.unitCostMinor, 0),
    };
  });
}
async function oneOrder(c: Context<AppEnv>, id: string) {
  const [order] = await loadOrders(c, id);
  if (!order) throw new HttpError(404, 'Purchase order not found', 'not_found');
  // sql/072: the supplier delivery notes received against this order (none until it is applied).
  const { data, error } = await userDb(c)
    .from('pur_receipts')
    .select('id, delivery_note_no, received_by, received_at')
    .eq('org_id', orgOf(c))
    .eq('order_id', id)
    .order('received_at', { ascending: true });
  if (error && !isMissingSchema(error)) throw error;
  const deliveryNotes = ((data ?? []) as { id: string; delivery_note_no: string; received_by: string; received_at: string }[]).map((r) => ({
    id: r.id,
    number: r.delivery_note_no,
    receivedBy: r.received_by,
    receivedAt: r.received_at,
  }));
  return { ...order, deliveryNotes };
}

// Each supplier's last cost per item (sql/097): recorded by the database from bills, and from orders while there is no bill price yet.
// ?itemId= or ?supplierId= narrows it. Read-only; nothing here changes a sales price.
purchasingRoutes.get('/supplier-prices', requirePermission('purchasing.prices.view'), async (c) => {
  const itemId = c.req.query('itemId');
  const supplierId = c.req.query('supplierId');
  if ((itemId && !UUID_RE.test(itemId)) || (supplierId && !UUID_RE.test(supplierId))) invalid('itemId and supplierId must be ids');
  let query = userDb(c)
    .from('pur_supplier_prices')
    .select('supplier_id, item_id, currency, last_cost_minor, source_kind, source_number, recorded_at')
    .eq('org_id', orgOf(c));
  if (itemId) query = query.eq('item_id', itemId);
  if (supplierId) query = query.eq('supplier_id', supplierId);
  const { data, error } = await query.order('recorded_at', { ascending: false }).range(...pageRange(c, 500));
  if (error) throw error;
  type Row = {
    supplier_id: string;
    item_id: string;
    currency: string;
    last_cost_minor: number;
    source_kind: string;
    source_number: string | null;
    recorded_at: string;
  };
  return ok(
    c,
    ((data ?? []) as Row[]).map((r) => ({
      supplierId: r.supplier_id,
      itemId: r.item_id,
      currency: r.currency,
      lastCostMinor: Number(r.last_cost_minor),
      source: r.source_kind,
      sourceNumber: r.source_number,
      recordedAt: r.recorded_at,
    })),
  );
});

purchasingRoutes.get('/suppliers', requirePermission('purchasing.suppliers.read'), async (c) => {
  // Every supplier, 1000 at a time (lib/paging.ts: a single read stopped at 1000 rows).
  const read = (columns: string) =>
    readAllPages((from, to) =>
      userDb(c)
        .from('pur_suppliers')
        .select(columns)
        .eq('org_id', orgOf(c))
        .is('deleted_at', null)
        .order('name')
        .order('id')
        .range(from, to),
    );
  // Until sql/076 is applied the new columns do not exist: read the old ones so the list still works.
  let { data, error } = await read(`id, code, name, contact, city, phone, payment_terms_days, ${SUPPLIER_DETAIL_COLUMNS}`);
  if (error && isMissingSchema(error)) ({ data, error } = await read('id, code, name, contact, city, phone, payment_terms_days'));
  if (error) throw error;
  return ok(c, ((data ?? []) as unknown as SupplierRow[]).map(supplier));
});
// A supplier's payment terms in days, or null for the company default (sql/041). The database allows owners and admins.
purchasingRoutes.put('/suppliers/:id/terms', requirePermission('purchasing.suppliers.manage'), async (c) => {
  const days = (await jsonBody(c)).days;
  if (days !== null && (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 365))
    invalid('days must be a whole number from 0 to 365, or null');
  await callRpc<void>(userDb(c), 'pur_set_supplier_terms', { p_supplier_id: idParam(c), p_days: days });
  return ok(c, { id: idParam(c), paymentTermsDays: days });
});
// Fix a supplier's name, contact, city or phone (sql/062, decision D4). The code stays; the old and new values are audited.
purchasingRoutes.put('/suppliers/:id', requirePermission('purchasing.suppliers.manage'), async (c) => {
  const body = await jsonBody(c);
  const { name, contact, city, phone } = partyBasics(body, 'Supplier name');
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'pur_update_supplier', {
    p_supplier_id: id,
    p_name: name,
    p_contact: contact,
    p_city: city,
    p_phone: phone,
    ...supplierDetails(body),
  });
  return ok(c, { id, name, contact: contact ?? '', city: city ?? '', phone: phone ?? '' });
});
// Change a supplier's code (sql/050). The database allows owners and admins; codes are unique per company.
purchasingRoutes.put('/suppliers/:id/code', requirePermission('purchasing.suppliers.manage'), async (c) => {
  const code = text((await jsonBody(c)).code);
  if (!/^[A-Za-z0-9-]{1,30}$/.test(code)) invalid('A code is letters, digits and dashes, up to 30');
  await callRpc<void>(userDb(c), 'pur_set_supplier_code', { p_supplier_id: idParam(c), p_code: code });
  return ok(c, { id: idParam(c), code });
});
purchasingRoutes.get('/orders', requirePermission('purchasing.orders.read'), async (c) => ok(c, await loadOrders(c)));
purchasingRoutes.get('/orders/:id', requirePermission('purchasing.orders.read'), async (c) => ok(c, await oneOrder(c, idParam(c))));
purchasingRoutes.post('/suppliers', requirePermission('purchasing.suppliers.manage'), async (c) => {
  const body = await jsonBody(c);
  const { name, contact, city, phone } = partyBasics(body, 'Supplier name');
  const id = await callRpc<string>(userDb(c), 'pur_create_supplier', {
    p_name: name,
    p_contact: contact,
    p_city: city,
    p_phone: phone,
    // sql/050: a typed code, or an automatic one (S-00001) when empty.
    p_code: text(body.code) || null,
    ...supplierDetails(body),
  });
  return ok(c, { id, name, contact: contact ?? '', city: city ?? '', phone: phone ?? '' }, 201);
});
purchasingRoutes.post('/orders', requirePermission('purchasing.orders.create'), async (c) => {
  const body = await jsonBody(c);
  const supplierId = text(body.supplierId);
  const warehouseId = text(body.warehouseId);
  const lines = (Array.isArray(body.lines) ? body.lines : []).map((line) => {
    const value = line as Record<string, unknown>;
    return { itemId: text(value.itemId), qty: Number(value.qty), unitCostMinor: Number(value.unitCostMinor), unit: text(value.unit) };
  });
  // A bad line refuses the order and says which (input audit, 25 Nov 2026: bad lines were dropped and the order saved without them).
  lines.forEach((l, i) => {
    if (!UUID_RE.test(l.itemId)) invalid(`Line ${i + 1}: choose an item`);
    if (!isGoodQty(l.qty)) invalid(`Line ${i + 1}: the quantity must be above 0, with at most 3 decimals`);
    if (!Number.isInteger(l.unitCostMinor) || l.unitCostMinor < 0 || l.unitCostMinor > MAX_MINOR)
      invalid(`Line ${i + 1}: the cost must be 0 or more`);
  });
  if (!UUID_RE.test(supplierId) || !UUID_RE.test(warehouseId) || lines.length === 0)
    invalid('Supplier, warehouse and at least one valid line are required');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'pur_create_order', {
    p_supplier_id: supplierId,
    p_warehouse_id: warehouseId,
    p_lines: lines.map(({ unit: _unit, ...l }) => l),
  });
  const unitsError = await setLineUnits(c, 'pur_set_order_line_units', made.id, lines);
  return ok(c, { ...(await oneOrder(c, made.id)), unitsError }, 201);
});
// Receive goods. No body: everything still to come (the old one-click receipt). With a body (sql/064, decision D3):
// { lines: [{ lineId, qty }], restComing: boolean } receives what actually arrived; restComing false closes the order short.
purchasingRoutes.post('/orders/:id/receive', requirePermission('purchasing.orders.receive'), async (c) => {
  const id = idParam(c);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.lines)) {
    await callRpc<void>(userDb(c), 'pur_receive_order', { p_order_id: id });
    return ok(c, await oneOrder(c, id));
  }
  const lines = body.lines.map((line) => {
    const value = (line ?? {}) as Record<string, unknown>;
    return { lineId: text(value.lineId), qty: Number(value.qty) };
  });
  if (typeof body.restComing !== 'boolean' || lines.some((l) => !UUID_RE.test(l.lineId) || !Number.isFinite(l.qty) || l.qty < 0))
    invalid('Each line needs a quantity of 0 or more, and say whether the rest is still coming');
  // sql/072: the supplier's delivery note number, optional; with one, the receipt and the note are recorded together.
  const note = text(body.deliveryNote);
  if (note.length > 60) invalid('The delivery note number is at most 60 characters');
  if (note)
    await callRpc<unknown>(userDb(c), 'pur_receive_with_note', {
      p_order_id: id,
      p_lines: lines,
      p_rest_coming: body.restComing,
      p_delivery_note: note,
    });
  else await callRpc<unknown>(userDb(c), 'pur_receive_lines', { p_order_id: id, p_lines: lines, p_rest_coming: body.restComing });
  return ok(c, await oneOrder(c, id));
});
purchasingRoutes.post('/orders/:id/cancel', requirePermission('purchasing.orders.manage'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'pur_cancel_order', { p_order_id: id });
  return ok(c, await oneOrder(c, id));
});

// sql/069: approve or reject an order waiting for approval (owners and admins, never their own unless the only one; a reason to reject).
purchasingRoutes.post('/orders/:id/decide', requirePermission('purchasing.orders.approve'), async (c) => {
  const id = idParam(c);
  const body = await jsonBody(c);
  const decision = text(body.decision);
  const note = text(body.note);
  if (decision !== 'approved' && decision !== 'rejected') invalid('decision: approved or rejected');
  if (decision === 'rejected' && !note) invalid('A reason is needed to reject');
  if (note.length > 500) invalid('The note is too long');
  await callRpc<unknown>(userDb(c), 'pur_decide_order', { p_order_id: id, p_decision: decision, p_note: note || null });
  return ok(c, await oneOrder(c, id));
});

// sql/073: the supplier confirmed the order for a date (and maybe their own reference). Changing the date later is allowed and audited.
purchasingRoutes.post('/orders/:id/confirm', requirePermission('purchasing.orders.receive'), async (c) => {
  const id = idParam(c);
  const body = await jsonBody(c);
  const date = text(body.promisedDate);
  const ref = text(body.supplierRef);
  if (!isIsoDay(date)) invalid('promisedDate: a date (YYYY-MM-DD)');
  if (ref.length > 60) invalid("The supplier's reference is at most 60 characters");
  await callRpc<unknown>(userDb(c), 'pur_confirm_order', { p_order_id: id, p_promised_date: date, p_supplier_ref: ref || null });
  return ok(c, await oneOrder(c, id));
});

// sql/069: whether purchase orders need approval, and from what total (minor units). Default: on, from 0.
purchasingRoutes.get('/order-approval', requirePermission('purchasing.orders.read'), async (c) =>
  ok(c, await callRpc<{ on: boolean; fromMinor: number }>(userDb(c), 'pur_po_approval', {})),
);
purchasingRoutes.put('/order-approval', requirePermission('purchasing.orders.manage'), async (c) => {
  const body = await jsonBody(c);
  const fromMinor = Number(body.fromMinor ?? 0);
  if (typeof body.on !== 'boolean' || !Number.isSafeInteger(fromMinor) || fromMinor < 0)
    invalid('on (true or false) and fromMinor (0 or more)');
  return ok(
    c,
    await callRpc<{ on: boolean; fromMinor: number }>(userDb(c), 'pur_set_po_approval', { p_on: body.on, p_from_minor: fromMinor }),
  );
});

// Bills are read with '*' so the code also answers before sql/087 is applied (then: no VAT, net = Σ round(qty × cost)).
purchasingRoutes.get('/supplier-invoices', requirePermission('purchasing.invoices.read'), async (c) => {
  // Paged (?offset=) and searched on the server (?q=: the supplier's invoice number or the supplier's name; Ben, 25 Nov 2026). It
  // stopped at the newest 250 with no way to older bills.
  const q = searchText(c);
  let query = userDb(c).from('pur_supplier_invoices').select('*').eq('org_id', orgOf(c));
  if (q) query = query.or(orFilter(q, ['number'], [['supplier_id', await idsMatching(userDb(c), 'pur_suppliers', 'name', orgOf(c), q)]]));
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id')
    .range(...pageRange(c, 250));
  if (error) throw error;
  const invoices = (data ?? []) as BillRow[];
  const ids = invoices.map((i) => i.id);
  const lineMap = new Map<string, BillLineOut[]>();
  if (ids.length) {
    // 250 bills can have more than 1000 lines: read every page (lib/paging.ts).
    const { data: lines, error: lineError } = await readAllPages((from, to) =>
      userDb(c).from('pur_supplier_invoice_lines').select('*').eq('org_id', orgOf(c)).in('invoice_id', ids).order('id').range(from, to),
    );
    if (lineError) throw lineError;
    for (const l of (lines ?? []) as BillLineRow[]) lineMap.set(l.invoice_id, [...(lineMap.get(l.invoice_id) ?? []), billLineOut(l)]);
  }
  return ok(
    c,
    invoices.map((i) => {
      const lines = lineMap.get(i.id) ?? [];
      return {
        id: i.id,
        number: i.number,
        supplierId: i.supplier_id,
        orderId: i.order_id,
        invoiceDate: i.invoice_date,
        dueDate: i.due_date,
        currency: i.currency,
        createdAt: i.created_at,
        lines,
        ...billTotals(i, lines),
      };
    }),
  );
});

// One purchase (supplier) invoice by id, same shape as the list (which holds the newest 250 only).
purchasingRoutes.get('/supplier-invoices/:id', requirePermission('purchasing.invoices.read'), async (c) => {
  const id = idParam(c);
  const { data: bill, error } = await userDb(c).from('pur_supplier_invoices').select('*').eq('org_id', orgOf(c)).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!bill) throw new HttpError(404, 'Invoice not found', 'not_found');
  const i = bill as BillRow;
  const { data: ls, error: le } = await userDb(c)
    .from('pur_supplier_invoice_lines')
    .select('*')
    .eq('org_id', orgOf(c))
    .eq('invoice_id', id);
  if (le) throw le;
  const raw = (ls ?? []) as BillLineRow[];
  // The item on each line and the order's number, so the page needs no other (capped) list to show them.
  const [orderLines, order] = await Promise.all([
    raw.length
      ? userDb(c)
          .from('pur_order_lines')
          .select('id,item_id')
          .eq('org_id', orgOf(c))
          .in(
            'id',
            raw.map((l) => l.order_line_id),
          )
      : Promise.resolve({ data: [], error: null }),
    userDb(c).from('pur_orders').select('number').eq('org_id', orgOf(c)).eq('id', i.order_id).maybeSingle(),
  ]);
  if (orderLines.error) throw orderLines.error;
  if (order.error) throw order.error;
  const itemOf = new Map(((orderLines.data ?? []) as { id: string; item_id: string }[]).map((l) => [l.id, l.item_id]));
  const lines = raw.map((l) => ({ ...billLineOut(l), itemId: itemOf.get(l.order_line_id) ?? null }));
  return ok(c, {
    id: i.id,
    number: i.number,
    supplierId: i.supplier_id,
    orderId: i.order_id,
    orderNumber: (order.data as { number: string } | null)?.number ?? null,
    invoiceDate: i.invoice_date,
    dueDate: i.due_date,
    currency: i.currency,
    createdAt: i.created_at,
    lines,
    ...billTotals(i, lines),
    ...(await supplierNoteTotals(c, i.id)),
  });
});

purchasingRoutes.get('/billing-summary', requirePermission('purchasing.orders.read'), async (c) => {
  const orders = await loadOrders(c);
  // sql/064: an open order with goods already in can be billed for what arrived.
  const received = orders.filter((o) => o.status === 'received' || o.partlyReceived);
  const orderIds = received.map((o) => o.id);
  if (!orderIds.length) return ok(c, []);
  const { data: orderLines, error } = await userDb(c)
    .from('pur_order_lines')
    .select('id,order_id,item_id,received_qty,unit_cost_minor')
    .eq('org_id', orgOf(c))
    .in('order_id', orderIds);
  if (error) throw error;
  const ls = (orderLines ?? []) as { id: string; order_id: string; item_id: string; received_qty: number; unit_cost_minor: number }[];
  const lineIds = ls.map((l) => l.id);
  const billed = new Map<string, number>();
  if (lineIds.length) {
    const { data: billLines, error: billError } = await userDb(c)
      .from('pur_supplier_invoice_lines')
      .select('order_line_id,qty')
      .eq('org_id', orgOf(c))
      .in('order_line_id', lineIds);
    if (billError) throw billError;
    for (const l of (billLines ?? []) as { order_line_id: string; qty: number }[])
      billed.set(l.order_line_id, (billed.get(l.order_line_id) ?? 0) + Number(l.qty));
  }
  return ok(
    c,
    received.map((o) => ({
      orderId: o.id,
      number: o.number,
      supplierId: o.supplierId,
      currency: o.currency,
      lines: ls
        .filter((l) => l.order_id === o.id)
        .map((l) => ({
          orderLineId: l.id,
          itemId: l.item_id,
          receivedQty: Number(l.received_qty),
          billedQty: billed.get(l.id) ?? 0,
          unitCostMinor: Number(l.unit_cost_minor),
        })),
    })),
  );
});

purchasingRoutes.post('/supplier-invoices', requirePermission('purchasing.invoices.record'), async (c) => {
  const body = await jsonBody(c);
  const supplierId = text(body.supplierId);
  const orderId = text(body.orderId);
  const number = text(body.number);
  if (number.length > 60) invalid("The supplier's invoice number: at most 60 characters");
  const invoiceDate = text(body.invoiceDate);
  const lines = (Array.isArray(body.lines) ? body.lines : [])
    .map((v) => {
      const l = v as Record<string, unknown>;
      // Optional VAT rate per line (sql/087): a rate id or "exempt"; omitted = the item's, else the company default.
      const taxRateId = text(l.taxRateId);
      if (taxRateId && taxRateId !== 'exempt' && !UUID_RE.test(taxRateId)) invalid('taxRateId must be a tax rate id or "exempt"');
      // Kind of purchase per line (sql/088): local goods and services, capital asset or import.
      const vatClass = text(l.vatClass);
      if (vatClass && !(VAT_CLASSES as readonly string[]).includes(vatClass)) invalid('vatClass must be local, capital or import');
      return {
        orderLineId: text(l.orderLineId),
        qty: Number(l.qty),
        ...(taxRateId ? { taxRateId } : {}),
        ...(vatClass ? { vatClass } : {}),
      };
    })
    .filter((l) => UUID_RE.test(l.orderLineId) && Number.isFinite(l.qty) && l.qty > 0);
  if (!UUID_RE.test(supplierId) || !UUID_RE.test(orderId) || !number || !isIsoDay(invoiceDate) || lines.length === 0)
    invalid('Supplier, received order, invoice number, date and billed quantities are required');
  const vat = parsePurchaseVat(body.vat);
  const id = await callRpc<string>(userDb(c), 'pur_record_supplier_invoice', {
    p_supplier_id: supplierId,
    p_order_id: orderId,
    p_number: number,
    p_invoice_date: invoiceDate,
    p_lines: lines,
    // only sent when given, so the call also works against a database without sql/087
    ...(vat ? { p_vat: vat } : {}),
  });
  const { data, error } = await userDb(c)
    .from('pur_supplier_invoices')
    .select('id,number,supplier_id,order_id,invoice_date,due_date,currency,created_at')
    .eq('org_id', orgOf(c))
    .eq('id', id)
    .single();
  if (error) throw error;
  return ok(
    c,
    {
      id: data.id,
      number: data.number,
      supplierId: data.supplier_id,
      orderId: data.order_id,
      invoiceDate: data.invoice_date,
      dueDate: data.due_date,
      currency: data.currency,
      createdAt: data.created_at,
    },
    201,
  );
});

// ---- supplier credit and debit notes (sql/094). The limits, approval rules and posting live in the database functions.
type PurNoteRow = Record<string, unknown> & {
  id: string;
  number: string;
  kind: string;
  status: string;
  currency: string;
  requester_id: string;
};
purchasingRoutes.get('/supplier-invoices/:id/notes', requirePermission('purchasing.notes.read'), async (c) => {
  const id = idParam(c);
  const db = userDb(c);
  const { data, error } = await db
    .from('pur_notes')
    .select('*')
    .eq('org_id', orgOf(c))
    .eq('bill_id', id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const notes = (data ?? []) as PurNoteRow[];
  const lines = new Map<string, unknown[]>();
  if (notes.length) {
    const { data: ls, error: le } = await db
      .from('pur_note_lines')
      .select('*')
      .eq('org_id', orgOf(c))
      .in(
        'note_id',
        notes.map((n) => n.id),
      );
    if (le) throw le;
    for (const l of (ls ?? []) as Record<string, unknown>[]) {
      const k = String(l.note_id);
      lines.set(k, [
        ...(lines.get(k) ?? []),
        {
          billLineId: l.bill_line_id,
          qty: Number(l.qty),
          unitCostMinor: Number(l.unit_cost_minor),
          taxRate: Number(l.tax_rate),
          netMinor: Number(l.net_minor),
          taxMinor: Number(l.tax_minor),
        },
      ]);
    }
  }
  return ok(
    c,
    notes.map((n) => ({
      id: n.id,
      number: n.number,
      kind: n.kind,
      status: n.status,
      currency: n.currency,
      reason: n.reason,
      supplierRef: n.supplier_ref ?? null,
      vatDocumentRef: n.vat_document_ref ?? null,
      netMinor: Number(n.net_minor),
      taxMinor: Number(n.tax_minor),
      grossMinor: Number(n.gross_minor),
      vatDeductible: n.vat_deductible === true,
      requesterId: n.requester_id,
      decidedBy: n.decided_by ?? null,
      decidedAt: n.decided_at ?? null,
      selfDecided: n.self_decided === true,
      createdAt: n.created_at,
      lines: lines.get(n.id) ?? [],
    })),
  );
});
purchasingRoutes.post('/supplier-invoices/:id/notes', requirePermission('purchasing.notes.create'), async (c) => {
  const id = idParam(c);
  const b = await jsonBody(c);
  const kind = text(b.kind);
  if (kind !== 'credit' && kind !== 'debit') invalid('kind must be credit or debit');
  const reason = text(b.reason);
  if (!reason || reason.length > 500) invalid('A reason of up to 500 characters is required');
  const lines = (Array.isArray(b.lines) ? b.lines : []).map((v) => {
    const l = v as Record<string, unknown>;
    const cost = l.unitCostMinor === undefined || l.unitCostMinor === null ? undefined : Number(l.unitCostMinor);
    return { billLineId: text(l.billLineId), qty: Number(l.qty), ...(cost === undefined ? {} : { unitCostMinor: cost }) };
  });
  if (
    !lines.length ||
    lines.some(
      (l) =>
        !UUID_RE.test(l.billLineId) ||
        !Number.isFinite(l.qty) ||
        l.qty <= 0 ||
        (l.unitCostMinor !== undefined && (!Number.isInteger(l.unitCostMinor) || l.unitCostMinor < 0)),
    )
  )
    invalid('Each line needs a bill line, a quantity above zero and, if given, a whole unit cost');
  const vat = parsePurchaseVat(b.vat);
  const made = await callRpc<unknown>(userDb(c), 'pur_submit_note', {
    p_bill_id: id,
    p_kind: kind,
    p_reason: reason,
    p_supplier_ref: text(b.supplierRef) || null,
    p_lines: lines,
    p_vat: vat ? { taxMinor: vat.taxMinor, documentRef: vat.documentRef } : null,
  });
  return ok(c, made, 201);
});
for (const [action, decision] of [
  ['approve', 'approved'],
  ['reject', 'rejected'],
] as const) {
  purchasingRoutes.post(`/notes/:id/${action}`, requirePermission('purchasing.notes.approve'), async (c) => {
    const id = idParam(c);
    const comment = text((await jsonBody(c)).comment) || null;
    await callRpc<void>(userDb(c), 'pur_decide_note', { p_note_id: id, p_decision: decision, p_comment: comment });
    return ok(c, { id, status: decision });
  });
}
purchasingRoutes.post('/notes/:id/cancel', requirePermission('purchasing.notes.create'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'pur_cancel_note', { p_note_id: id });
  return ok(c, { id, status: 'cancelled' });
});

// Approved supplier notes on a bill (sql/094): what was credited and debited. Before that migration: none.
async function supplierNoteTotals(c: Context<AppEnv>, billId: string) {
  const { data, error } = await userDb(c)
    .from('pur_notes')
    .select('kind, gross_minor')
    .eq('org_id', orgOf(c))
    .eq('bill_id', billId)
    .eq('status', 'approved');
  if (error) {
    if (isMissingSchema(error)) return { creditedMinor: 0, debitedMinor: 0 };
    throw error;
  }
  let creditedMinor = 0;
  let debitedMinor = 0;
  for (const n of (data ?? []) as { kind: string; gross_minor: number }[]) {
    if (n.kind === 'credit') creditedMinor += Number(n.gross_minor);
    else debitedMinor += Number(n.gross_minor);
  }
  return { creditedMinor, debitedMinor };
}

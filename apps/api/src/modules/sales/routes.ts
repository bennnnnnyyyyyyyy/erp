import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { createBostaDelivery, type ShipmentInfo } from '../../lib/shipping/bosta';
import { billingFor } from './billing';
import { registerNoteRoutes } from './notes';

export const salesRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
const idParam = (c: Context<AppEnv>) => {
  const id = c.req.param('id') ?? '';
  if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found');
  return id;
};
type Order = {
  id: string;
  number: string;
  customer_id: string;
  warehouse_id: string;
  status: string;
  currency: string;
  request_id: string | null;
  created_by: string;
  created_at: string;
};
async function loadOrders(c: Context<AppEnv>, id?: string) {
  let q = userDb(c)
    .from('sal_orders')
    .select('id,number,customer_id,warehouse_id,status,currency,request_id,created_by,created_at')
    .eq('org_id', orgOf(c))
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (id) q = q.eq('id', id);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Order[];
  const ids = rows.map((o) => o.id);
  const lineMap = new Map<string, { id: string; itemId: string; qty: number; unitPriceMinor: number }[]>();
  if (ids.length) {
    const { data: ls, error: le } = await userDb(c)
      .from('sal_order_lines')
      .select('id,order_id,item_id,qty,unit_price_minor')
      .eq('org_id', orgOf(c))
      .in('order_id', ids);
    if (le) throw le;
    for (const l of (ls ?? []) as { id: string; order_id: string; item_id: string; qty: number; unit_price_minor: number }[])
      lineMap.set(l.order_id, [
        ...(lineMap.get(l.order_id) ?? []),
        { id: l.id, itemId: l.item_id, qty: Number(l.qty), unitPriceMinor: Number(l.unit_price_minor) },
      ]);
  }
  const requestIds = rows.map((o) => o.request_id).filter((x): x is string => Boolean(x));
  const requestMap = new Map<string, { id: string; number: string; status: string }>();
  if (requestIds.length) {
    const { data: rs, error: re } = await userDb(c)
      .from('inv_requests')
      .select('id,number,status')
      .eq('org_id', orgOf(c))
      .in('id', requestIds);
    if (re) throw re;
    for (const r of (rs ?? []) as { id: string; number: string; status: string }[]) requestMap.set(r.id, r);
  }
  return rows.map((o) => {
    const lines = lineMap.get(o.id) ?? [];
    const request = o.request_id ? (requestMap.get(o.request_id) ?? null) : null;
    const status =
      o.status === 'cancelled'
        ? 'cancelled'
        : request?.status === 'issued'
          ? 'delivered'
          : request?.status === 'approved'
            ? 'approved'
            : request && request.status !== 'rejected' && request.status !== 'cancelled'
              ? 'stock_requested'
              : 'open';
    return {
      id: o.id,
      number: o.number,
      customerId: o.customer_id,
      warehouseId: o.warehouse_id,
      status,
      lines,
      totalMinor: lines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0),
      currency: o.currency,
      requestId: o.request_id,
      requestStatus: request?.status ?? null,
      requestNumber: request?.number ?? null,
      createdBy: o.created_by,
      createdAt: o.created_at,
    };
  });
}
async function one(c: Context<AppEnv>, id: string) {
  const [o] = await loadOrders(c, id);
  if (!o) throw new HttpError(404, 'Sales order not found', 'not_found');
  return o;
}
salesRoutes.get('/customers', requirePermission('sales.customers.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('sal_customers')
    .select('id,code,name,contact,city,phone,payment_terms_days')
    .eq('org_id', orgOf(c))
    .is('deleted_at', null)
    .order('name');
  if (error) throw error;
  return ok(
    c,
    (
      (data ?? []) as {
        id: string;
        code: string;
        name: string;
        contact: string | null;
        city: string | null;
        phone: string | null;
        payment_terms_days: number | null;
      }[]
    ).map((x) => ({
      id: x.id,
      kind: 'customer',
      code: x.code,
      name: x.name,
      contact: x.contact ?? '',
      city: x.city ?? '',
      phone: x.phone ?? '',
      /** null = the company default (sql/041). */
      paymentTermsDays: x.payment_terms_days,
    })),
  );
});
// A customer's payment terms in days, or null for the company default (sql/041). The database allows owners and admins.
salesRoutes.put('/customers/:id/terms', requirePermission('sales.customers.manage'), async (c) => {
  const days = (await jsonBody(c)).days;
  if (days !== null && (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 365))
    invalid('days must be a whole number from 0 to 365, or null');
  await callRpc<void>(userDb(c), 'sal_set_customer_terms', { p_customer_id: idParam(c), p_days: days });
  return ok(c, { id: idParam(c), paymentTermsDays: days });
});
// Change a customer's code (sql/050). The database allows owners and admins; codes are unique per company.
salesRoutes.put('/customers/:id/code', requirePermission('sales.customers.manage'), async (c) => {
  const code = text((await jsonBody(c)).code);
  if (!/^[A-Za-z0-9-]{1,30}$/.test(code)) invalid('A code is letters, digits and dashes, up to 30');
  await callRpc<void>(userDb(c), 'sal_set_customer_code', { p_customer_id: idParam(c), p_code: code });
  return ok(c, { id: idParam(c), code });
});
salesRoutes.get('/orders', requirePermission('sales.orders.read'), async (c) => ok(c, await loadOrders(c)));
salesRoutes.get('/orders/:id', requirePermission('sales.orders.read'), async (c) => ok(c, await one(c, idParam(c))));
salesRoutes.post('/customers', requirePermission('sales.customers.manage'), async (c) => {
  const b = await jsonBody(c);
  const name = text(b.name);
  if (!name) invalid('Customer name is required');
  const id = await callRpc<string>(userDb(c), 'sal_create_customer', {
    p_name: name,
    p_contact: text(b.contact) || null,
    p_city: text(b.city) || null,
    p_phone: text(b.phone) || null,
    // sql/050: a typed code, or an automatic one (C-00001) when empty.
    p_code: text(b.code) || null,
  });
  return ok(c, { id, kind: 'customer', name, contact: text(b.contact), city: text(b.city), phone: text(b.phone) }, 201);
});
salesRoutes.post('/orders', requirePermission('sales.orders.create'), async (c) => {
  const b = await jsonBody(c);
  const customerId = text(b.customerId),
    warehouseId = text(b.warehouseId);
  const lines = (Array.isArray(b.lines) ? b.lines : [])
    .map((v) => {
      const l = v as Record<string, unknown>;
      return { itemId: text(l.itemId), qty: Number(l.qty), unitPriceMinor: Number(l.unitPriceMinor) };
    })
    .filter(
      (l) => UUID_RE.test(l.itemId) && Number.isFinite(l.qty) && l.qty > 0 && Number.isInteger(l.unitPriceMinor) && l.unitPriceMinor >= 0,
    );
  if (!UUID_RE.test(customerId) || !UUID_RE.test(warehouseId) || !lines.length)
    invalid('Customer, warehouse and at least one valid line are required');
  const made = await callRpc<{ id: string }>(userDb(c), 'sal_create_order', {
    p_customer_id: customerId,
    p_warehouse_id: warehouseId,
    p_lines: lines,
  });
  return ok(c, await one(c, made.id), 201);
});
salesRoutes.post('/orders/:id/request-stock', requirePermission('sales.orders.fulfill'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'sal_request_stock', { p_order_id: id });
  return ok(c, await one(c, id));
});
// ---- customer invoices (sql/022): created and voided by database functions; price always comes from the order line
type InvoiceRow = {
  id: string;
  number: string;
  order_id: string;
  customer_id: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  status: string;
  created_at: string;
};
salesRoutes.get('/invoices', requirePermission('sales.invoices.read'), async (c) => {
  const { data, error } = await userDb(c)
    .from('sal_invoices')
    .select('id,number,order_id,customer_id,invoice_date,due_date,currency,status,created_at')
    .eq('org_id', orgOf(c))
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as InvoiceRow[];
  const ids = rows.map((r) => r.id);
  const byInvoice = new Map<string, { orderLineId: string; qty: number; unitPriceMinor: number }[]>();
  if (ids.length) {
    const { data: ls, error: le } = await userDb(c)
      .from('sal_invoice_lines')
      .select('invoice_id,order_line_id,qty,unit_price_minor')
      .eq('org_id', orgOf(c))
      .in('invoice_id', ids);
    if (le) throw le;
    for (const l of (ls ?? []) as { invoice_id: string; order_line_id: string; qty: number; unit_price_minor: number }[]) {
      const a = byInvoice.get(l.invoice_id) ?? [];
      a.push({ orderLineId: l.order_line_id, qty: Number(l.qty), unitPriceMinor: Number(l.unit_price_minor) });
      byInvoice.set(l.invoice_id, a);
    }
  }
  return ok(
    c,
    rows.map((r) => {
      const lines = byInvoice.get(r.id) ?? [];
      return {
        id: r.id,
        number: r.number,
        orderId: r.order_id,
        customerId: r.customer_id,
        invoiceDate: r.invoice_date,
        dueDate: r.due_date,
        currency: r.currency,
        status: r.status,
        lines,
        totalMinor: lines.reduce((n, l) => n + Math.round(l.qty * l.unitPriceMinor), 0),
        createdAt: r.created_at,
      };
    }),
  );
});
// One invoice by id, same shape as the list (the list holds the newest 200 only, so a record page must not rely on it).
salesRoutes.get('/invoices/:id', requirePermission('sales.invoices.read'), async (c) => {
  const id = idParam(c);
  const { data: r, error } = await userDb(c)
    .from('sal_invoices')
    .select('id,number,order_id,customer_id,invoice_date,due_date,currency,status,created_at')
    .eq('org_id', orgOf(c))
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!r) throw new HttpError(404, 'Invoice not found', 'not_found');
  const row = r as InvoiceRow;
  const { data: ls, error: le } = await userDb(c)
    .from('sal_invoice_lines')
    .select('order_line_id,qty,unit_price_minor')
    .eq('org_id', orgOf(c))
    .eq('invoice_id', id);
  if (le) throw le;
  const lines = ((ls ?? []) as { order_line_id: string; qty: number; unit_price_minor: number }[]).map((l) => ({
    orderLineId: l.order_line_id,
    qty: Number(l.qty),
    unitPriceMinor: Number(l.unit_price_minor),
  }));
  return ok(c, {
    id: row.id,
    number: row.number,
    orderId: row.order_id,
    customerId: row.customer_id,
    invoiceDate: row.invoice_date,
    dueDate: row.due_date,
    currency: row.currency,
    status: row.status,
    lines,
    totalMinor: lines.reduce((n, l) => n + Math.round(l.qty * l.unitPriceMinor), 0),
    createdAt: row.created_at,
  });
});
// Ordered / delivered / invoiced per line of one order, with a flag for what does not match.
salesRoutes.get('/orders/:id/billing', requirePermission('sales.invoices.read'), async (c) => {
  const order = await one(c, idParam(c));
  const { data, error } = await userDb(c)
    .from('sal_invoice_lines')
    .select('order_line_id,qty,sal_invoices!inner(status)')
    .eq('org_id', orgOf(c))
    .in(
      'order_line_id',
      order.lines.map((l: { id?: string }) => l.id ?? ''),
    );
  if (error) throw error;
  const invoiced = new Map<string, number>();
  for (const l of (data ?? []) as unknown as {
    order_line_id: string;
    qty: number;
    sal_invoices: { status: string } | { status: string }[];
  }[]) {
    const st = Array.isArray(l.sal_invoices) ? l.sal_invoices[0]?.status : l.sal_invoices?.status;
    if (st === 'issued') invoiced.set(l.order_line_id, (invoiced.get(l.order_line_id) ?? 0) + Number(l.qty));
  }
  return ok(
    c,
    billingFor(
      order.lines.map((l: { id?: string; itemId: string; qty: number }) => ({ orderLineId: l.id ?? '', itemId: l.itemId, qty: l.qty })),
      order.requestStatus,
      invoiced,
    ),
  );
});
salesRoutes.post('/orders/:id/invoices', requirePermission('sales.invoices.manage'), async (c) => {
  const id = idParam(c);
  const b = await jsonBody(c);
  const date = text(b.invoiceDate) || new Date().toISOString().slice(0, 10);
  const lines = (Array.isArray(b.lines) ? b.lines : [])
    .map((v) => {
      const l = v as Record<string, unknown>;
      return { orderLineId: text(l.orderLineId), qty: Number(l.qty) };
    })
    .filter((l) => UUID_RE.test(l.orderLineId) && Number.isFinite(l.qty) && l.qty > 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !lines.length) invalid('An invoice date and at least one valid line are required');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'sal_create_invoice', {
    p_order_id: id,
    p_invoice_date: date,
    p_lines: lines,
  });
  return ok(c, made, 201);
});
salesRoutes.post('/invoices/:id/void', requirePermission('sales.invoices.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'sal_void_invoice', { p_invoice_id: id });
  return ok(c, { id, status: 'void' });
});
salesRoutes.post('/orders/:id/cancel', requirePermission('sales.orders.manage'), async (c) => {
  const id = idParam(c);
  await callRpc(userDb(c), 'sal_cancel_order', { p_order_id: id });
  return ok(c, await one(c, id));
});
// ---- credit and debit notes with approval (sql/037); see ./notes.ts
registerNoteRoutes(salesRoutes);

// ---- Bosta shipments (sql/058). A courier update never changes stock or money; cash on delivery is settled in finance.
const SHIP_COLS =
  'id, order_id, provider, reference, tracking, status, state_code, cod_minor, currency, recipient_name, recipient_phone, city, address, simulated, note, created_at, updated_at';
const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');

salesRoutes.get('/shipments', requirePermission('sales.orders.read'), async (c) => {
  const order = c.req.query('orderId') ?? '';
  if (order && !UUID_RE.test(order)) invalid('Invalid order');
  let q = userDb(c)
    .from('sal_shipments')
    .select(SHIP_COLS)
    .eq('org_id', c.var.tenant.orgId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (order) q = q.eq('order_id', order);
  const { data, error } = await q;
  if (error) throw error;
  return ok(c, data ?? []);
});

salesRoutes.post('/shipments', requirePermission('sales.orders.fulfill'), async (c) => {
  const b = await jsonBody(c);
  const orderId = str(b.orderId);
  const cod = b.codMinor === undefined || b.codMinor === null ? 0 : Number(b.codMinor);
  if (
    !UUID_RE.test(orderId) ||
    !str(b.recipientName) ||
    str(b.recipientPhone).length < 5 ||
    !str(b.city) ||
    str(b.address).length < 3 ||
    !Number.isInteger(cod) ||
    cod < 0
  )
    invalid('Order, recipient name, phone, city and address are required; cash on delivery must be zero or more');
  const db = userDb(c);
  const ship = await callRpc<ShipmentInfo>(db, 'sal_create_shipment', {
    p_order_id: orderId,
    p_recipient_name: str(b.recipientName),
    p_recipient_phone: str(b.recipientPhone),
    p_city: str(b.city),
    p_address: str(b.address),
    p_cod_minor: cod,
  });
  if (ship.simulated) return ok(c, ship, 201);
  try {
    const { tracking } = await createBostaDelivery(c.env, db, ship, new URL(c.req.url).origin);
    return ok(c, { ...ship, tracking }, 201);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Bosta could not be reached';
    await callRpc<void>(db, 'sal_shipment_fail', { p_shipment_id: ship.id, p_reason: reason }).catch(() => undefined);
    throw new HttpError(502, reason, 'provider_error');
  }
});

salesRoutes.post('/shipments/:id/cancel', requirePermission('sales.orders.fulfill'), async (c) => {
  const id = idParam(c);
  await callRpc<void>(userDb(c), 'sal_cancel_shipment', { p_shipment_id: id });
  return ok(c, { id, status: 'cancelled' });
});

salesRoutes.post('/shipments/:id/simulate-step', requirePermission('sales.orders.manage'), async (c) => {
  const id = idParam(c);
  return ok(c, await callRpc<{ result: string; status?: string }>(userDb(c), 'sal_simulate_shipment_step', { p_shipment_id: id }));
});

// ---- Shopify orders in (sql/059): what arrived, what is held for review, and a simulated test order.
salesRoutes.get('/online-orders', requirePermission('core.integrations.view'), async (c) => {
  const { data, error } = await userDb(c)
    .from('sal_shopify_orders')
    .select('id, shopify_order_id, shopify_name, status, review_reason, sales_order_id, simulated, total_minor, currency, created_at')
    .eq('org_id', c.var.tenant.orgId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return ok(c, data ?? []);
});

salesRoutes.post('/online-orders/test', requirePermission('core.integrations.manage'), async (c) => {
  return ok(c, await callRpc<{ result: string; orderNumber?: string; reason?: string }>(userDb(c), 'sal_shopify_test_order', {}), 201);
});

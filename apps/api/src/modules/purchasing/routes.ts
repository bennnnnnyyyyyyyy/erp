import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid, jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

// Orders are immutable commitments. Receipt is a single database function that posts stock and audit atomically.
export const purchasingRoutes = new Hono<AppEnv>();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf = (c: Context<AppEnv>) => c.var.tenant.orgId;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const idParam = (c: Context<AppEnv>) => { const id = c.req.param('id') ?? ''; if (!UUID_RE.test(id)) throw new HttpError(404, 'Not found', 'not_found'); return id; };
type SupplierRow = { id: string; name: string; contact: string | null; city: string | null; phone: string | null };
type OrderRow = { id: string; number: string; supplier_id: string; warehouse_id: string; status: 'ordered' | 'received' | 'cancelled'; currency: string; created_by: string; created_at: string; received_at: string | null };
const supplier = (s: SupplierRow) => ({ id: s.id, name: s.name, contact: s.contact ?? '', city: s.city ?? '', phone: s.phone ?? '' });

async function loadOrders(c: Context<AppEnv>, id?: string) {
  let query = userDb(c).from('pur_orders').select('id, number, supplier_id, warehouse_id, status, currency, created_by, created_at, received_at').eq('org_id', orgOf(c)).is('deleted_at', null).order('created_at', { ascending: false }).limit(200);
  if (id) query = query.eq('id', id);
  const { data, error } = await query; if (error) throw error;
  const rows = (data ?? []) as OrderRow[]; const ids = rows.map((o) => o.id);
  const lines = new Map<string, { itemId: string; qty: number; unitCostMinor: number }[]>();
  if (ids.length) {
    const { data: lineRows, error: lineError } = await userDb(c).from('pur_order_lines').select('order_id, item_id, qty, unit_cost_minor').eq('org_id', orgOf(c)).in('order_id', ids);
    if (lineError) throw lineError;
    for (const l of (lineRows ?? []) as { order_id: string; item_id: string; qty: number; unit_cost_minor: number }[]) lines.set(l.order_id, [...(lines.get(l.order_id) ?? []), { itemId: l.item_id, qty: Number(l.qty), unitCostMinor: Number(l.unit_cost_minor) }]);
  }
  return rows.map((o) => { const orderLines = lines.get(o.id) ?? []; return { id: o.id, number: o.number, supplierId: o.supplier_id, warehouseId: o.warehouse_id, status: o.status, currency: o.currency, createdBy: o.created_by, createdAt: o.created_at, receivedAt: o.received_at, lines: orderLines, totalMinor: orderLines.reduce((sum, l) => sum + l.qty * l.unitCostMinor, 0) }; });
}
async function oneOrder(c: Context<AppEnv>, id: string) { const [order] = await loadOrders(c, id); if (!order) throw new HttpError(404, 'Purchase order not found', 'not_found'); return order; }

purchasingRoutes.get('/suppliers', requirePermission('purchasing.suppliers.read'), async (c) => { const { data, error } = await userDb(c).from('pur_suppliers').select('id, name, contact, city, phone').eq('org_id', orgOf(c)).is('deleted_at', null).order('name'); if (error) throw error; return ok(c, ((data ?? []) as SupplierRow[]).map(supplier)); });
purchasingRoutes.get('/orders', requirePermission('purchasing.orders.read'), async (c) => ok(c, await loadOrders(c)));
purchasingRoutes.get('/orders/:id', requirePermission('purchasing.orders.read'), async (c) => ok(c, await oneOrder(c, idParam(c))));
purchasingRoutes.post('/suppliers', requirePermission('purchasing.suppliers.manage'), async (c) => { const body = await jsonBody(c); const name = text(body.name); if (!name) invalid('Supplier name is required'); const id = await callRpc<string>(userDb(c), 'pur_create_supplier', { p_name: name, p_contact: text(body.contact) || null, p_city: text(body.city) || null, p_phone: text(body.phone) || null }); return ok(c, { id, name, contact: text(body.contact), city: text(body.city), phone: text(body.phone) }, 201); });
purchasingRoutes.post('/orders', requirePermission('purchasing.orders.create'), async (c) => {
  const body = await jsonBody(c); const supplierId = text(body.supplierId); const warehouseId = text(body.warehouseId);
  const lines = (Array.isArray(body.lines) ? body.lines : []).map((line) => { const value = line as Record<string, unknown>; return { itemId: text(value.itemId), qty: Number(value.qty), unitCostMinor: Number(value.unitCostMinor) }; }).filter((line) => UUID_RE.test(line.itemId) && Number.isFinite(line.qty) && line.qty > 0 && Number.isFinite(line.unitCostMinor) && Number.isInteger(line.unitCostMinor) && line.unitCostMinor >= 0);
  if (!UUID_RE.test(supplierId) || !UUID_RE.test(warehouseId) || lines.length === 0) invalid('Supplier, warehouse and at least one valid line are required');
  const made = await callRpc<{ id: string; number: string }>(userDb(c), 'pur_create_order', { p_supplier_id: supplierId, p_warehouse_id: warehouseId, p_lines: lines }); return ok(c, await oneOrder(c, made.id), 201);
});
purchasingRoutes.post('/orders/:id/receive', requirePermission('purchasing.orders.receive'), async (c) => { const id = idParam(c); await callRpc<void>(userDb(c), 'pur_receive_order', { p_order_id: id }); return ok(c, await oneOrder(c, id)); });
purchasingRoutes.post('/orders/:id/cancel', requirePermission('purchasing.orders.manage'), async (c) => { const id = idParam(c); await callRpc<void>(userDb(c), 'pur_cancel_order', { p_order_id: id }); return ok(c, await oneOrder(c, id)); });

purchasingRoutes.get('/supplier-invoices', requirePermission('purchasing.invoices.read'), async (c) => {
  const { data, error } = await userDb(c).from('pur_supplier_invoices').select('id,number,supplier_id,order_id,invoice_date,currency,created_at').eq('org_id',orgOf(c)).order('created_at',{ascending:false}).limit(250);
  if (error) throw error;
  const invoices=(data??[]) as {id:string;number:string;supplier_id:string;order_id:string;invoice_date:string;currency:string;created_at:string}[];
  const ids=invoices.map((i)=>i.id); const lineMap=new Map<string,{orderLineId:string;qty:number;unitCostMinor:number}[]>();
  if(ids.length){const {data: lines,error: lineError}=await userDb(c).from('pur_supplier_invoice_lines').select('invoice_id,order_line_id,qty,unit_cost_minor').eq('org_id',orgOf(c)).in('invoice_id',ids);if(lineError)throw lineError;for(const l of (lines??[]) as {invoice_id:string;order_line_id:string;qty:number;unit_cost_minor:number}[])lineMap.set(l.invoice_id,[...(lineMap.get(l.invoice_id)??[]),{orderLineId:l.order_line_id,qty:Number(l.qty),unitCostMinor:Number(l.unit_cost_minor)}]);}
  return ok(c,invoices.map(i=>{const lines=lineMap.get(i.id)??[];return{id:i.id,number:i.number,supplierId:i.supplier_id,orderId:i.order_id,invoiceDate:i.invoice_date,currency:i.currency,createdAt:i.created_at,lines,totalMinor:lines.reduce((n,l)=>n+l.qty*l.unitCostMinor,0)}}));
});

purchasingRoutes.get('/billing-summary',requirePermission('purchasing.orders.read'),async(c)=>{
  const orders=await loadOrders(c);
  const received=orders.filter(o=>o.status==='received');
  const orderIds=received.map(o=>o.id);
  if(!orderIds.length)return ok(c,[]);
  const {data: orderLines,error}=await userDb(c).from('pur_order_lines').select('id,order_id,item_id,qty,unit_cost_minor').eq('org_id',orgOf(c)).in('order_id',orderIds);
  if(error)throw error;
  const ls=(orderLines??[]) as {id:string;order_id:string;item_id:string;qty:number;unit_cost_minor:number}[];
  const lineIds=ls.map(l=>l.id);const billed=new Map<string,number>();
  if(lineIds.length){const {data:billLines,error:billError}=await userDb(c).from('pur_supplier_invoice_lines').select('order_line_id,qty').eq('org_id',orgOf(c)).in('order_line_id',lineIds);if(billError)throw billError;for(const l of (billLines??[]) as {order_line_id:string;qty:number}[])billed.set(l.order_line_id,(billed.get(l.order_line_id)??0)+Number(l.qty));}
  return ok(c,received.map(o=>({orderId:o.id,number:o.number,supplierId:o.supplierId,currency:o.currency,lines:ls.filter(l=>l.order_id===o.id).map(l=>({orderLineId:l.id,itemId:l.item_id,receivedQty:Number(l.qty),billedQty:billed.get(l.id)??0,unitCostMinor:Number(l.unit_cost_minor)}))})));
});

purchasingRoutes.post('/supplier-invoices',requirePermission('purchasing.invoices.record'),async(c)=>{
  const body=await jsonBody(c);const supplierId=text(body.supplierId);const orderId=text(body.orderId);const number=text(body.number);const invoiceDate=text(body.invoiceDate);
  const lines=(Array.isArray(body.lines)?body.lines:[]).map(v=>{const l=v as Record<string,unknown>;return{orderLineId:text(l.orderLineId),qty:Number(l.qty)}}).filter(l=>UUID_RE.test(l.orderLineId)&&Number.isFinite(l.qty)&&l.qty>0);
  if(!UUID_RE.test(supplierId)||!UUID_RE.test(orderId)||!number||!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)||lines.length===0)invalid('Supplier, received order, invoice number, date and billed quantities are required');
  const id=await callRpc<string>(userDb(c),'pur_record_supplier_invoice',{p_supplier_id:supplierId,p_order_id:orderId,p_number:number,p_invoice_date:invoiceDate,p_lines:lines});
  const {data,error}=await userDb(c).from('pur_supplier_invoices').select('id,number,supplier_id,order_id,invoice_date,currency,created_at').eq('org_id',orgOf(c)).eq('id',id).single();if(error)throw error;
  return ok(c,{id:data.id,number:data.number,supplierId:data.supplier_id,orderId:data.order_id,invoiceDate:data.invoice_date,currency:data.currency,createdAt:data.created_at},201);
});

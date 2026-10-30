import { Hono,type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid,jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';
import { billingFor } from './billing';

export const salesRoutes=new Hono<AppEnv>();
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf=(c:Context<AppEnv>)=>c.var.tenant.orgId;const text=(x:unknown)=>typeof x==='string'?x.trim():'';
const idParam=(c:Context<AppEnv>)=>{const id=c.req.param('id')??'';if(!UUID_RE.test(id))throw new HttpError(404,'Not found','not_found');return id};
type Order={id:string;number:string;customer_id:string;warehouse_id:string;status:string;currency:string;request_id:string|null;created_by:string;created_at:string};
async function loadOrders(c:Context<AppEnv>,id?:string){
 let q=userDb(c).from('sal_orders').select('id,number,customer_id,warehouse_id,status,currency,request_id,created_by,created_at').eq('org_id',orgOf(c)).is('deleted_at',null).order('created_at',{ascending:false}).limit(200);if(id)q=q.eq('id',id);const {data,error}=await q;if(error)throw error;
 const rows=(data??[]) as Order[];const ids=rows.map(o=>o.id);const lineMap=new Map<string,{id:string;itemId:string;qty:number;unitPriceMinor:number}[]>();
 if(ids.length){const {data:ls,error:le}=await userDb(c).from('sal_order_lines').select('id,order_id,item_id,qty,unit_price_minor').eq('org_id',orgOf(c)).in('order_id',ids);if(le)throw le;for(const l of (ls??[]) as {id:string;order_id:string;item_id:string;qty:number;unit_price_minor:number}[])lineMap.set(l.order_id,[...(lineMap.get(l.order_id)??[]),{id:l.id,itemId:l.item_id,qty:Number(l.qty),unitPriceMinor:Number(l.unit_price_minor)}]);}
 const requestIds=rows.map(o=>o.request_id).filter((x):x is string=>Boolean(x));const requestMap=new Map<string,{id:string;number:string;status:string}>();
 if(requestIds.length){const {data:rs,error:re}=await userDb(c).from('inv_requests').select('id,number,status').eq('org_id',orgOf(c)).in('id',requestIds);if(re)throw re;for(const r of (rs??[]) as {id:string;number:string;status:string}[])requestMap.set(r.id,r);}
 return rows.map(o=>{const lines=lineMap.get(o.id)??[];const request=o.request_id?requestMap.get(o.request_id)??null:null;const status=o.status==='cancelled'?'cancelled':request?.status==='issued'?'delivered':request?.status==='approved'?'approved':request&&request.status!=='rejected'&&request.status!=='cancelled'?'stock_requested':'open';return{id:o.id,number:o.number,customerId:o.customer_id,warehouseId:o.warehouse_id,status,lines,totalMinor:lines.reduce((n,l)=>n+l.qty*l.unitPriceMinor,0),currency:o.currency,requestId:o.request_id,requestStatus:request?.status??null,createdBy:o.created_by,createdAt:o.created_at};});
}
async function one(c:Context<AppEnv>,id:string){const [o]=await loadOrders(c,id);if(!o)throw new HttpError(404,'Sales order not found','not_found');return o;}
salesRoutes.get('/customers',requirePermission('sales.customers.read'),async c=>{const {data,error}=await userDb(c).from('sal_customers').select('id,name,contact,city,phone').eq('org_id',orgOf(c)).is('deleted_at',null).order('name');if(error)throw error;return ok(c,(data??[]).map((x:{id:string;name:string;contact:string|null;city:string|null;phone:string|null})=>({id:x.id,kind:'customer',name:x.name,contact:x.contact??'',city:x.city??'',phone:x.phone??''})));});
salesRoutes.get('/orders',requirePermission('sales.orders.read'),async c=>ok(c,await loadOrders(c)));
salesRoutes.get('/orders/:id',requirePermission('sales.orders.read'),async c=>ok(c,await one(c,idParam(c))));
salesRoutes.post('/customers',requirePermission('sales.customers.manage'),async c=>{const b=await jsonBody(c);const name=text(b.name);if(!name)invalid('Customer name is required');const id=await callRpc<string>(userDb(c),'sal_create_customer',{p_name:name,p_contact:text(b.contact)||null,p_city:text(b.city)||null,p_phone:text(b.phone)||null});return ok(c,{id,kind:'customer',name,contact:text(b.contact),city:text(b.city),phone:text(b.phone)},201);});
salesRoutes.post('/orders',requirePermission('sales.orders.create'),async c=>{const b=await jsonBody(c);const customerId=text(b.customerId),warehouseId=text(b.warehouseId);const lines=(Array.isArray(b.lines)?b.lines:[]).map(v=>{const l=v as Record<string,unknown>;return{itemId:text(l.itemId),qty:Number(l.qty),unitPriceMinor:Number(l.unitPriceMinor)}}).filter(l=>UUID_RE.test(l.itemId)&&Number.isFinite(l.qty)&&l.qty>0&&Number.isInteger(l.unitPriceMinor)&&l.unitPriceMinor>=0);if(!UUID_RE.test(customerId)||!UUID_RE.test(warehouseId)||!lines.length)invalid('Customer, warehouse and at least one valid line are required');const made=await callRpc<{id:string}>(userDb(c),'sal_create_order',{p_customer_id:customerId,p_warehouse_id:warehouseId,p_lines:lines});return ok(c,await one(c,made.id),201);});
salesRoutes.post('/orders/:id/request-stock',requirePermission('sales.orders.fulfill'),async c=>{const id=idParam(c);await callRpc(userDb(c),'sal_request_stock',{p_order_id:id});return ok(c,await one(c,id));});
// ---- customer invoices (sql/022): created and voided by database functions; price always comes from the order line
type InvoiceRow={id:string;number:string;order_id:string;customer_id:string;invoice_date:string;currency:string;status:string;created_at:string};
salesRoutes.get('/invoices',requirePermission('sales.invoices.read'),async c=>{
 const {data,error}=await userDb(c).from('sal_invoices').select('id,number,order_id,customer_id,invoice_date,currency,status,created_at').eq('org_id',orgOf(c)).order('created_at',{ascending:false}).limit(200);if(error)throw error;
 const rows=(data??[]) as InvoiceRow[];const ids=rows.map(r=>r.id);const byInvoice=new Map<string,{orderLineId:string;qty:number;unitPriceMinor:number}[]>();
 if(ids.length){const {data:ls,error:le}=await userDb(c).from('sal_invoice_lines').select('invoice_id,order_line_id,qty,unit_price_minor').eq('org_id',orgOf(c)).in('invoice_id',ids);if(le)throw le;for(const l of (ls??[]) as {invoice_id:string;order_line_id:string;qty:number;unit_price_minor:number}[]){const a=byInvoice.get(l.invoice_id)??[];a.push({orderLineId:l.order_line_id,qty:Number(l.qty),unitPriceMinor:Number(l.unit_price_minor)});byInvoice.set(l.invoice_id,a);}}
 return ok(c,rows.map(r=>{const lines=byInvoice.get(r.id)??[];return{id:r.id,number:r.number,orderId:r.order_id,customerId:r.customer_id,invoiceDate:r.invoice_date,currency:r.currency,status:r.status,lines,totalMinor:lines.reduce((n,l)=>n+Math.round(l.qty*l.unitPriceMinor),0),createdAt:r.created_at};}));
});
// Ordered / delivered / invoiced per line of one order, with a flag for what does not match.
salesRoutes.get('/orders/:id/billing',requirePermission('sales.invoices.read'),async c=>{
 const order=await one(c,idParam(c));
 const {data,error}=await userDb(c).from('sal_invoice_lines').select('order_line_id,qty,sal_invoices!inner(status)').eq('org_id',orgOf(c)).in('order_line_id',order.lines.map((l:{id?:string})=>l.id??''));
 if(error)throw error;
 const invoiced=new Map<string,number>();for(const l of (data??[]) as unknown as {order_line_id:string;qty:number;sal_invoices:{status:string}|{status:string}[]}[]){const st=Array.isArray(l.sal_invoices)?l.sal_invoices[0]?.status:l.sal_invoices?.status;if(st==='issued')invoiced.set(l.order_line_id,(invoiced.get(l.order_line_id)??0)+Number(l.qty));}
 return ok(c,billingFor(order.lines.map((l:{id?:string;itemId:string;qty:number})=>({orderLineId:l.id??'',itemId:l.itemId,qty:l.qty})),order.requestStatus,invoiced));
});
salesRoutes.post('/orders/:id/invoices',requirePermission('sales.invoices.manage'),async c=>{
 const id=idParam(c);const b=await jsonBody(c);const date=text(b.invoiceDate)||new Date().toISOString().slice(0,10);
 const lines=(Array.isArray(b.lines)?b.lines:[]).map(v=>{const l=v as Record<string,unknown>;return{orderLineId:text(l.orderLineId),qty:Number(l.qty)}}).filter(l=>UUID_RE.test(l.orderLineId)&&Number.isFinite(l.qty)&&l.qty>0);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!lines.length)invalid('An invoice date and at least one valid line are required');
 const made=await callRpc<{id:string;number:string}>(userDb(c),'sal_create_invoice',{p_order_id:id,p_invoice_date:date,p_lines:lines});return ok(c,made,201);
});
salesRoutes.post('/invoices/:id/void',requirePermission('sales.invoices.manage'),async c=>{const id=idParam(c);await callRpc(userDb(c),'sal_void_invoice',{p_invoice_id:id});return ok(c,{id,status:'void'});});
salesRoutes.post('/orders/:id/cancel',requirePermission('sales.orders.manage'),async c=>{const id=idParam(c);await callRpc(userDb(c),'sal_cancel_order',{p_order_id:id});return ok(c,await one(c,id));});

import { Hono,type Context } from 'hono';
import type { AppEnv } from '../../env';
import { invalid,jsonBody } from '../../lib/body';
import { userDb } from '../../lib/db.user';
import { HttpError } from '../../lib/errors';
import { callRpc } from '../../lib/rpc';
import { ok } from '../../lib/response';
import { requirePermission } from '../../middleware/tenant';

export const salesRoutes=new Hono<AppEnv>();
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const orgOf=(c:Context<AppEnv>)=>c.var.tenant.orgId;const text=(x:unknown)=>typeof x==='string'?x.trim():'';
const idParam=(c:Context<AppEnv>)=>{const id=c.req.param('id')??'';if(!UUID_RE.test(id))throw new HttpError(404,'Not found','not_found');return id};
type Order={id:string;number:string;customer_id:string;warehouse_id:string;status:string;currency:string;request_id:string|null;created_by:string;created_at:string};
async function loadOrders(c:Context<AppEnv>,id?:string){
 let q=userDb(c).from('sal_orders').select('id,number,customer_id,warehouse_id,status,currency,request_id,created_by,created_at').eq('org_id',orgOf(c)).is('deleted_at',null).order('created_at',{ascending:false}).limit(200);if(id)q=q.eq('id',id);const {data,error}=await q;if(error)throw error;
 const rows=(data??[]) as Order[];const ids=rows.map(o=>o.id);const lineMap=new Map<string,{itemId:string;qty:number;unitPriceMinor:number}[]>();
 if(ids.length){const {data:ls,error:le}=await userDb(c).from('sal_order_lines').select('order_id,item_id,qty,unit_price_minor').eq('org_id',orgOf(c)).in('order_id',ids);if(le)throw le;for(const l of (ls??[]) as {order_id:string;item_id:string;qty:number;unit_price_minor:number}[])lineMap.set(l.order_id,[...(lineMap.get(l.order_id)??[]),{itemId:l.item_id,qty:Number(l.qty),unitPriceMinor:Number(l.unit_price_minor)}]);}
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
salesRoutes.post('/orders/:id/cancel',requirePermission('sales.orders.manage'),async c=>{const id=idParam(c);await callRpc(userDb(c),'sal_cancel_order',{p_order_id:id});return ok(c,await one(c,id));});

import { useState } from 'react';
import { formatMoney } from '@erp/shared';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { formatDateTime } from '../../lib/format';
import { Pill } from '../trade/common';

type Summary = { orderId:string;number:string;supplierId:string;currency:string;lines:{orderLineId:string;itemId:string;receivedQty:number;billedQty:number;unitCostMinor:number}[] };
type Supplier = {id:string;name:string};
type Item = {id:string;sku:string;name:string};
type Invoice = {id:string;number:string;supplierId:string;orderId:string;invoiceDate:string;currency:string;createdAt:string;totalMinor:number};
const money=(amountMinor:number,currency:string)=>formatMoney({amountMinor,currency});

export function SupplierInvoices(){
  const summaries=useLoad(()=>api<Summary[]>('/v1/purchasing/billing-summary'));
  const invoices=useLoad(()=>api<Invoice[]>('/v1/purchasing/supplier-invoices'));
  const suppliers=useLoad(()=>api<Supplier[]>('/v1/purchasing/suppliers'));
  const items=useLoad(()=>api<Item[]>('/v1/inventory/items'));
  const session=useSession();
  const [orderId,setOrderId]=useState('');const [number,setNumber]=useState('');const [invoiceDate,setInvoiceDate]=useState(new Date().toISOString().slice(0,10));
  const [quantities,setQuantities]=useState<Record<string,string>>({});const [busy,setBusy]=useState(false);const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
  const summary=summaries.data?.find(o=>o.orderId===orderId);
  const summaryRows=summaries.data??[];
  const supplierName=(id:string)=>suppliers.data?.find(s=>s.id===id)?.name??id;
  const itemName=(id:string)=>{const i=items.data?.find(v=>v.id===id);return i?`${i.sku} · ${i.name}`:id};
  async function submit(){
    if(!summary)return;setBusy(true);setMessage(null);
    try{await api('/v1/purchasing/supplier-invoices',{method:'POST',body:JSON.stringify({supplierId:summary.supplierId,orderId,number,invoiceDate,lines:summary.lines.filter(l=>Number(quantities[l.orderLineId])>0).map(l=>({orderLineId:l.orderLineId,qty:Number(quantities[l.orderLineId])}))})});setMessage({ok:true,text:'Supplier invoice recorded.'});setOrderId('');setNumber('');setQuantities({});summaries.reload();invoices.reload();}
    catch(e){setMessage({ok:false,text:(e as Error).message})}finally{setBusy(false)}
  }
  if(!summaries.data||!invoices.data||!suppliers.data||!items.data)return <section className="page"><p className="muted">Loading…</p></section>;
  return <section className="page">
    <h1>Supplier invoices</h1><p className="muted">Record supplier bills against received purchase orders and track billed quantities.</p>
    {message&&<p className={message.ok?'notice':'error notice'}>{message.text}</p>}
    {session.role!=='viewer'&&<div className="form-card stack">
      <h2>Record an invoice</h2>
      <div className="form-row">
        <label>Received purchase order<select value={orderId} onChange={e=>{setOrderId(e.target.value);setQuantities({})}}><option value="">Choose an order…</option>{summaries.data.filter(o=>o.lines.some(l=>l.billedQty<l.receivedQty)).map(o=><option key={o.orderId} value={o.orderId}>{o.number} · {supplierName(o.supplierId)}</option>)}</select></label>
        <label>Supplier invoice number<input value={number} onChange={e=>setNumber(e.target.value)} required /></label>
        <label>Invoice date<input type="date" value={invoiceDate} onChange={e=>setInvoiceDate(e.target.value)} required /></label>
      </div>
      {summary&&<><div className="table-wrap"><table><thead><tr><th>Item</th><th className="right">Received</th><th className="right">Already billed</th><th>Billed on this invoice</th></tr></thead><tbody>{summary.lines.map(l=><tr key={l.orderLineId}><td>{itemName(l.itemId)}</td><td className="right">{l.receivedQty}</td><td className="right">{l.billedQty}</td><td><input aria-label={`Quantity billed for ${itemName(l.itemId)}`} type="number" min="0" max={l.receivedQty-l.billedQty} step="0.001" value={quantities[l.orderLineId]??''} onChange={e=>setQuantities(q=>({...q,[l.orderLineId]:e.target.value}))} /></td></tr>)}</tbody></table></div><button disabled={busy||!number.trim()||!Object.values(quantities).some(q=>Number(q)>0)} onClick={submit}>{busy?'Recording…':'Record supplier invoice'}</button></>}
    </div>}
    <h2 className="related">Received orders and billing progress</h2>
    <div className="table-wrap"><table><thead><tr><th>Purchase order</th><th>Supplier</th><th>Received value</th><th>Billed value</th><th>Remaining</th><th>Status</th></tr></thead><tbody>
      {summaryRows.map(o=>{const received=o.lines.reduce((n,l)=>n+l.receivedQty*l.unitCostMinor,0);const billed=o.lines.reduce((n,l)=>n+l.billedQty*l.unitCostMinor,0);return <tr key={o.orderId}><td><code>{o.number}</code></td><td>{supplierName(o.supplierId)}</td><td>{money(received,o.currency)}</td><td>{money(billed,o.currency)}</td><td>{money(received-billed,o.currency)}</td><td><Pill status={billed===0?'ordered':billed>=received?'received':'submitted'} label={billed===0?'Not billed':billed>=received?'Fully billed':'Part billed'} /></td></tr>})}
      {!summaries.data.length&&<tr><td colSpan={6} className="muted empty">No received purchase orders to bill yet.</td></tr>}
    </tbody></table></div>
    <h2 className="related">Recorded invoices</h2><div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Supplier</th><th>Purchase order</th><th>Date recorded</th><th className="right">Amount</th></tr></thead><tbody>
      {invoices.data.map(i=><tr key={i.id}><td><code>{i.number}</code></td><td>{supplierName(i.supplierId)}</td><td><code>{summaryRows.find(o=>o.orderId===i.orderId)?.number??i.orderId}</code></td><td>{formatDateTime(i.createdAt,session.org)}</td><td className="right">{money(i.totalMinor,i.currency)}</td></tr>)}
      {!invoices.data.length&&<tr><td colSpan={5} className="muted empty">No supplier invoices recorded yet.</td></tr>}
    </tbody></table></div>
  </section>;
}

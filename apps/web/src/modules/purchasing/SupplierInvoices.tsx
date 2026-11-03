import { useState } from 'react';
import { formatMoney } from '@erp/shared';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { formatDateTime } from '../../lib/format';
import { Pill } from '../trade/common';
import { ClickRow } from '../../components/ClickRow';
import { FormToggle } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { RecordHistory } from '../../components/RecordHistory';
import { Link, useParam } from '../../lib/router';
import { PaymentsAgainst } from '../finance/FinanceRecords';

import { tr, trf } from '../../lib/i18n';
type Summary = { orderId:string;number:string;supplierId:string;currency:string;lines:{orderLineId:string;itemId:string;receivedQty:number;billedQty:number;unitCostMinor:number}[] };
type Supplier = {id:string;name:string};
type Item = {id:string;sku:string;name:string};
type Invoice = {id:string;number:string;supplierId:string;orderId:string;invoiceDate:string;currency:string;createdAt:string;totalMinor:number;lines:{orderLineId:string;qty:number;unitCostMinor:number}[]};
const money=(amountMinor:number,currency:string)=>formatMoney({amountMinor,currency});

export function SupplierInvoices(){
  const summaries=useLoad(()=>api<Summary[]>('/v1/purchasing/billing-summary'));
  const invoices=useLoad(()=>api<Invoice[]>('/v1/purchasing/supplier-invoices'));
  const suppliers=useLoad(()=>api<Supplier[]>('/v1/purchasing/suppliers'));
  const items=useLoad(()=>api<Item[]>('/v1/inventory/items'));
  const session=useSession();
  const [orderId,setOrderId]=useState('');const [number,setNumber]=useState('');const [invoiceDate,setInvoiceDate]=useState(new Date().toISOString().slice(0,10));
  const [quantities,setQuantities]=useState<Record<string,string>>({});const [busy,setBusy]=useState(false);const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
  const [showAll,setShowAll]=useState(false);const [formOpen,setFormOpen]=useState(false);
  const summary=summaries.data?.find(o=>o.orderId===orderId);
  const summaryRows=summaries.data??[];
  const supplierName=(id:string)=>suppliers.data?.find(s=>s.id===id)?.name??id;
  const itemName=(id:string)=>{const i=items.data?.find(v=>v.id===id);return i?`${i.sku} · ${i.name}`:id};
  async function submit(){
    if(!summary)return;setBusy(true);setMessage(null);
    try{await api('/v1/purchasing/supplier-invoices',{method:'POST',body:JSON.stringify({supplierId:summary.supplierId,orderId,number,invoiceDate,lines:summary.lines.filter(l=>Number(quantities[l.orderLineId])>0).map(l=>({orderLineId:l.orderLineId,qty:Number(quantities[l.orderLineId])}))})});setMessage({ok:true,text:tr('Supplier invoice recorded.')});setOrderId('');setNumber('');setQuantities({});summaries.reload();invoices.reload();}
    catch(e){setMessage({ok:false,text:(e as Error).message})}finally{setBusy(false)}
  }
  if(!summaries.data||!invoices.data||!suppliers.data||!items.data)return <section className="page"><p className="muted">{tr('Loading…')}</p></section>;
  const billingRows=summaryRows.map(o=>({o,received:o.lines.reduce((n,l)=>n+l.receivedQty*l.unitCostMinor,0),billed:o.lines.reduce((n,l)=>n+l.billedQty*l.unitCostMinor,0)}));
  const toBill=billingRows.filter(r=>r.billed<r.received);
  const shownBilling=showAll?billingRows:toBill;
  return <section className="page">
    <h1>{tr('Supplier invoices')}</h1><p className="muted">{tr('Record supplier bills against received purchase orders and track billed quantities.')}</p>
    {message&&<p className={message.ok?'notice':'error notice'}>{message.text}</p>}
    {session.role!=='viewer'&&<FormToggle label={tr('Record an invoice')} open={formOpen} onOpenChange={setFormOpen}>
      <div className="form-row">
        <label>{tr('Received purchase order')}<select value={orderId} onChange={e=>{setOrderId(e.target.value);setQuantities({})}}><option value="">{tr('Choose an order…')}</option>{summaries.data.filter(o=>o.lines.some(l=>l.billedQty<l.receivedQty)).map(o=><option key={o.orderId} value={o.orderId}>{o.number} · {supplierName(o.supplierId)}</option>)}</select></label>
        <label>{tr('Supplier invoice number')}<input value={number} onChange={e=>setNumber(e.target.value)} required /></label>
        <label>{tr('Invoice date')}<input type="date" value={invoiceDate} onChange={e=>setInvoiceDate(e.target.value)} required /></label>
      </div>
      {summary&&<><div className="table-wrap"><table><thead><tr><th>{tr('Item')}</th><th className="right">{tr('Received')}</th><th className="right">{tr('Already billed')}</th><th>{tr('Billed on this invoice')}</th></tr></thead><tbody>{summary.lines.map(l=><tr key={l.orderLineId}><td>{itemName(l.itemId)}</td><td className="right">{l.receivedQty}</td><td className="right">{l.billedQty}</td><td><input aria-label={trf('Quantity billed for {item}', { item: itemName(l.itemId) })} type="number" min="0" max={l.receivedQty-l.billedQty} step="0.001" value={quantities[l.orderLineId]??''} onChange={e=>setQuantities(q=>({...q,[l.orderLineId]:e.target.value}))} /></td></tr>)}</tbody></table></div><button disabled={busy||!number.trim()||!Object.values(quantities).some(q=>Number(q)>0)} onClick={submit}>{busy?tr('Recording…'):tr('Record supplier invoice')}</button></>}
    </FormToggle>}
    <h2 className="related">{tr('Recorded invoices')}</h2><div className="table-wrap"><table><thead><tr><th>{tr('Invoice')}</th><th>{tr('Supplier')}</th><th>{tr('Purchase order')}</th><th>{tr('Date recorded')}</th><th className="right">{tr('Amount')}</th></tr></thead><tbody>
      {invoices.data.map(i=><ClickRow key={i.id} to={`/purchasing/invoices/${i.id}`}><td><Link to={`/purchasing/invoices/${i.id}`}><code>{i.number}</code></Link></td><td>{supplierName(i.supplierId)}</td><td><Link to={`/purchasing/orders/${i.orderId}`}><code>{summaryRows.find(o=>o.orderId===i.orderId)?.number??'—'}</code></Link></td><td className="nowrap">{formatDateTime(i.createdAt,session.org)}</td><td className="right">{money(i.totalMinor,i.currency)}</td></ClickRow>)}
      {!invoices.data.length&&<tr><td colSpan={5} className="muted empty">{tr('No supplier invoices recorded yet.')}</td></tr>}
    </tbody></table></div>
    {/* Billing progress: only orders not yet fully billed, unless the person asks for all (most received orders are fully billed). */}
    <div className="section-head">
      <h2 className="related">{showAll?tr('Received orders and billing progress'):tr('Received orders still to bill')} <span className="muted small">({shownBilling.length})</span></h2>
      {billingRows.length>toBill.length&&<Button variant="ghost" size="sm" onClick={()=>setShowAll(!showAll)}>{showAll?tr('Only orders that need attention'):trf('Show all {count} orders',{count:billingRows.length})}</Button>}
    </div>
    <div className="table-wrap"><table><thead><tr><th>{tr('Purchase order')}</th><th>{tr('Supplier')}</th><th className="right">{tr('Received value')}</th><th className="right">{tr('Billed value')}</th><th className="right">{tr('Remaining')}</th><th>{tr('Status')}</th></tr></thead><tbody>
      {shownBilling.map(({o,received,billed})=><ClickRow key={o.orderId} to={`/purchasing/orders/${o.orderId}`}><td><Link to={`/purchasing/orders/${o.orderId}`}><code>{o.number}</code></Link></td><td>{supplierName(o.supplierId)}</td><td className="right">{money(received,o.currency)}</td><td className="right">{money(billed,o.currency)}</td><td className="right">{money(received-billed,o.currency)}</td><td><Pill status={billed===0?'ordered':billed>=received?'received':'submitted'} label={billed===0?tr('Not billed'):billed>=received?tr('Fully billed'):tr('Part billed')} /></td></ClickRow>)}
      {!shownBilling.length&&<tr><td colSpan={6} className="muted empty">{summaries.data.length?tr('Every received order is fully billed.'):tr('No received purchase orders to bill yet.')}</td></tr>}
    </tbody></table></div>
  </section>;
}

/** One supplier invoice: supplier, purchase order, the billed lines and total, payments made against it, and its history. */
export function SupplierInvoicePage() {
  const id = useParam('id');
  const session = useSession();
  const invoices = useLoad(() => api<Invoice[]>('/v1/purchasing/supplier-invoices'));
  const summaries = useLoad(() => api<Summary[]>('/v1/purchasing/billing-summary'));
  const suppliers = useLoad(() => api<Supplier[]>('/v1/purchasing/suppliers'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));

  if (invoices.error) return <section className="page"><p className="error">{invoices.error}</p></section>;
  if (!invoices.data || !summaries.data || !suppliers.data || !items.data) return <section className="page"><p className="muted">{tr('Loading…')}</p></section>;
  const inv = invoices.data.find((i) => i.id === id);
  if (!inv) return <section className="page"><Link to="/purchasing/invoices" className="back-link">{tr('← Supplier invoices')}</Link><p className="muted">{tr('This invoice was not found.')}</p></section>;
  const order = summaries.data.find((o) => o.orderId === inv.orderId);
  const supplier = suppliers.data.find((s) => s.id === inv.supplierId)?.name ?? '—';
  const itemOf = (orderLineId: string) => {
    const itemId = order?.lines.find((l) => l.orderLineId === orderLineId)?.itemId;
    const i = items.data?.find((v) => v.id === itemId);
    return i ? `${i.sku} · ${i.name}` : '—';
  };

  return (
    <section className="page">
      <Link to="/purchasing/invoices" className="back-link">{tr('← Supplier invoices')}</Link>
      <div className="page-head"><h1 className="mono">{inv.number}</h1></div>
      <dl className="facts">
        <div><dt>{tr('Supplier')}</dt><dd>{supplier}</dd></div>
        <div><dt>{tr('Purchase order')}</dt><dd><Link to={`/purchasing/orders/${inv.orderId}`}><code>{order?.number ?? '—'}</code></Link></dd></div>
        <div><dt>{tr('Invoice date')}</dt><dd>{inv.invoiceDate}</dd></div>
        <div><dt>{tr('Date recorded')}</dt><dd>{formatDateTime(inv.createdAt, session.org)}</dd></div>
        <div><dt>{tr('Total')}</dt><dd className="amount">{money(inv.totalMinor, inv.currency)}</dd></div>
      </dl>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr('Item')}</th><th className="right">{tr('Quantity')}</th><th className="right">{tr('Unit cost')}</th><th className="right">{tr('Line total')}</th></tr></thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.orderLineId}><td>{itemOf(l.orderLineId)}</td><td className="right">{l.qty}</td><td className="right">{money(l.unitCostMinor, inv.currency)}</td><td className="right">{money(l.qty * l.unitCostMinor, inv.currency)}</td></tr>
          ))}
          <tr><td colSpan={3} className="right"><strong>{tr('Total')}</strong></td><td className="right"><strong>{money(inv.totalMinor, inv.currency)}</strong></td></tr>
        </tbody>
      </table></div>
      <PaymentsAgainst field="supplierInvoiceId" id={inv.id} totalMinor={inv.totalMinor} currency={inv.currency} />
      <RecordHistory key={inv.id} id={inv.id} />
    </section>
  );
}

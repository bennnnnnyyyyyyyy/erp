import { DateInput } from '../../components/DateInput';
import { Attachments } from '../../components/Attachments';
import { useState } from 'react';
import { Loading } from '../../components/Loading';
import { formatMoney, hasPermission, type VatSettings } from '@erp/shared';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { formatDateTime, formatDay } from '../../lib/format';
import { Pill } from '../trade/common';
import { ClickRow } from '../../components/ClickRow';
import { FormToggle } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { RecordHistory } from '../../components/RecordHistory';
import { BackLink, Link, useParam } from '../../lib/router';
import { PaymentsAgainst } from '../finance/FinanceRecords';
import { UnpaidBills } from './UnpaidBills';
import { SupplierNotes } from './SupplierNotes';
import { PurchaseVatFields, emptyPurchaseVat, purchaseVatPayload, type PurchaseVat } from '../finance/PurchaseVatFields';

import { TheirCodeCell, TheirCodeHeader, codesFor, usePartyCodes } from '../inventory/PartyCodes';
import { tr, trf } from '../../lib/i18n';
import { ScanBill } from './ScanBill';
type Summary = { orderId:string;number:string;supplierId:string;currency:string;lines:{orderLineId:string;itemId:string;receivedQty:number;billedQty:number;unitCostMinor:number}[] };
type Supplier = {id:string;name:string};
type Item = {id:string;sku:string;name:string};
// netMinor / taxMinor (as printed) / computedTaxMinor / grossMinor and the VAT details: sql/087. Optional while an older API answers.
type BillLine = {billLineId?:string;orderLineId:string;qty:number;unitCostMinor:number;taxRate?:number;netMinor?:number;taxMinor?:number;vatClass?:string;costVatMinor?:number};
type Invoice = {id:string;number:string;supplierId:string;orderId:string;invoiceDate:string;dueDate?:string;currency:string;createdAt:string;totalMinor:number;netMinor?:number;taxMinor?:number;computedTaxMinor?:number;grossMinor?:number;vatDeductible?:boolean;vatClass?:string;vatDocumentRef?:string|null;supplierTaxNumber?:string|null;creditedMinor?:number;debitedMinor?:number;lines:BillLine[]};
const money=(amountMinor:number,currency:string)=>formatMoney({amountMinor,currency});

export function SupplierInvoices(){
  const summaries=useLoad(()=>api<Summary[]>('/v1/purchasing/billing-summary'));
  const invoices=useLoad(()=>api<Invoice[]>('/v1/purchasing/supplier-invoices'));
  const suppliers=useLoad(()=>api<Supplier[]>('/v1/purchasing/suppliers'));
  const items=useLoad(()=>api<Item[]>('/v1/inventory/items'));
  const vat=useLoad(()=>api<VatSettings>('/v1/core/org/vat').catch(()=>null));
  const [vatIn,setVatIn]=useState<PurchaseVat>(emptyPurchaseVat);const [lineRate,setLineRate]=useState<Record<string,string>>({});const [lineKind,setLineKind]=useState<Record<string,string>>({});
  const session=useSession();
  // "Record the supplier's invoice" on a received purchase order opens this page with ?order=… chosen (dead-ends audit, 25 Nov).
  const [orderId,setOrderId]=useState(()=>new URLSearchParams(window.location.search).get('order')??'');const [number,setNumber]=useState('');const [invoiceDate,setInvoiceDate]=useState(new Date().toISOString().slice(0,10));
  const [quantities,setQuantities]=useState<Record<string,string>>({});const [busy,setBusy]=useState(false);const [message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
  const [showAll,setShowAll]=useState(false);const [formOpen,setFormOpen]=useState(()=>new URLSearchParams(window.location.search).has('order'));const [scanOpen,setScanOpen]=useState(false);
  const summary=summaries.data?.find(o=>o.orderId===orderId);
  const summaryRows=summaries.data??[];
  // Each line starts with what is left to bill (received - billed), as sales does (dead-ends audit, 25 Nov); a typed value wins.
  const qtyFor=(l:{orderLineId:string;receivedQty:number;billedQty:number})=>quantities[l.orderLineId]??String(Math.max(0,l.receivedQty-l.billedQty));
  const anyQty=!!summary&&summary.lines.some(l=>Number(qtyFor(l))>0);
  const supplierName=(id:string)=>suppliers.data?.find(s=>s.id===id)?.name??id;
  const itemName=(id:string)=>{const i=items.data?.find(v=>v.id===id);return i?`${i.sku} · ${i.name}`:id};
  async function submit(){
    if(!summary)return;setBusy(true);setMessage(null);
    try{await api('/v1/purchasing/supplier-invoices',{method:'POST',body:JSON.stringify({supplierId:summary.supplierId,orderId,number,invoiceDate,lines:summary.lines.filter(l=>Number(qtyFor(l))>0).map(l=>({orderLineId:l.orderLineId,qty:Number(qtyFor(l)),...(lineRate[l.orderLineId]?{taxRateId:lineRate[l.orderLineId]}:{}),...(lineKind[l.orderLineId]?{vatClass:lineKind[l.orderLineId]}:{})})),vat:purchaseVatPayload(vatIn)})});setMessage({ok:true,text:tr('Purchase invoice recorded.')});setOrderId('');setNumber('');setQuantities({});setVatIn(emptyPurchaseVat);setLineRate({});setLineKind({});summaries.reload();invoices.reload();}
    catch(e){setMessage({ok:false,text:(e as Error).message})}finally{setBusy(false)}
  }
  if(!summaries.data||!invoices.data||!suppliers.data||!items.data)return <section className="page"><Loading error={summaries.error??invoices.error??suppliers.error??items.error} /></section>;
  const billingRows=summaryRows.map(o=>({o,received:o.lines.reduce((n,l)=>n+l.receivedQty*l.unitCostMinor,0),billed:o.lines.reduce((n,l)=>n+l.billedQty*l.unitCostMinor,0)}));
  const toBill=billingRows.filter(r=>r.billed<r.received);
  const billable=summaries.data.filter(o=>o.lines.some(l=>l.billedQty<l.receivedQty));
  const shownBilling=showAll?billingRows:toBill;
  return <section className="page">
    <h1>{tr('Purchase invoices')}</h1><p className="muted">{tr('Bills from suppliers for the goods you received.')}</p>
    {message&&(message.ok||!(formOpen&&summary))&&<p className={message.ok?'notice':'error notice'}>{message.text}</p>}
    {hasPermission(session.permissions,'purchasing.bills.scan')&&hasPermission(session.permissions,'purchasing.invoices.record')&&<FormToggle label={tr('Scan a bill')} open={scanOpen} onOpenChange={setScanOpen}><ScanBill suppliers={suppliers.data} onSaved={()=>{summaries.reload();invoices.reload();}} /></FormToggle>}
    {hasPermission(session.permissions,'purchasing.invoices.record')&&<FormToggle label={tr('Record an invoice')} open={formOpen} onOpenChange={setFormOpen}>
      <div className="form-row">
        {/* Dead-ends audit, 25 Nov: only orders with received goods not yet billed can be billed; with none, say why and where to go. */}
        {billable.length===0?<div className="notice" role="status"><p style={{marginBlock:0}}>{tr('No received goods are waiting for a bill. Receive the goods on the purchase order first.')}</p><Link to="/purchasing/orders">{tr('Purchase orders')}</Link></div>:<label>{tr('Received purchase order')}<select value={orderId} onChange={e=>{setOrderId(e.target.value);setQuantities({})}}><option value="">{tr('Choose an order…')}</option>{billable.map(o=><option key={o.orderId} value={o.orderId}>{o.number} · {supplierName(o.supplierId)}</option>)}</select></label>}
        <label>{tr('Supplier\'s invoice number')}<input value={number} onChange={e=>setNumber(e.target.value)} required /></label>
        <label>{tr('Invoice date')}<DateInput value={invoiceDate} onChange={e=>setInvoiceDate(e.target.value)} required /></label>
      </div>
      {summary&&<><div className="table-wrap"><table><thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Received')}</th><th scope="col" className="right">{tr('Already billed')}</th><th scope="col">{tr('Quantity on this invoice')}</th>{vat.data?.rates.length?<th scope="col">{tr('VAT')}</th>:null}<th scope="col">{tr('Kind of purchase')}</th></tr></thead><tbody>{summary.lines.map(l=><tr key={l.orderLineId}><td>{itemName(l.itemId)}</td><td className="right">{l.receivedQty}</td><td className="right">{l.billedQty}</td><td><input aria-label={trf('Quantity billed for {item}', { item: itemName(l.itemId) })} type="number" min="0" max={l.receivedQty-l.billedQty} step="0.001" value={qtyFor(l)} onChange={e=>setQuantities(q=>({...q,[l.orderLineId]:e.target.value}))} /></td>{vat.data?.rates.length?<td><select aria-label={trf('VAT for {item}',{item:itemName(l.itemId)})} value={lineRate[l.orderLineId]??''} onChange={e=>setLineRate(r=>({...r,[l.orderLineId]:e.target.value}))}><option value="">{tr('Item or company default')}</option>{vat.data.rates.map(r=><option key={r.id} value={r.id}>{r.label} ({r.rate}%)</option>)}<option value="exempt">{tr('No VAT (exempt)')}</option></select></td>:null}<td><select aria-label={trf('Kind of purchase for {item}',{item:itemName(l.itemId)})} value={lineKind[l.orderLineId]??'local'} onChange={e=>setLineKind(k=>({...k,[l.orderLineId]:e.target.value}))}><option value="local">{tr('Goods and services')}</option><option value="capital">{tr('Capital asset (equipment, machinery)')}</option><option value="import">{tr('Import (customs)')}</option></select></td></tr>)}</tbody></table></div><PurchaseVatFields value={vatIn} onChange={setVatIn} vat={vat.data} kind="bill" />{message&&!message.ok&&<p className="error notice" role="alert">{message.text}</p>}<Button type="submit" disabled={busy||!number.trim()||!anyQty} onClick={submit}>{busy?tr('Recording…'):tr('Record purchase invoice')}</Button>{!busy&&(!number.trim()||!anyQty)&&<p className="muted small">{!number.trim()?tr('Enter the supplier\'s invoice number.'):''} {!anyQty?tr('Enter a quantity on at least one line.'):''}</p>}</>}
    </FormToggle>}
    <UnpaidBills supplierName={supplierName} />
    <h2 className="related">{tr('Recorded invoices')}</h2><div className="table-wrap"><table><thead><tr><th scope="col">{tr('Invoice')}</th><th scope="col">{tr('Supplier')}</th><th scope="col">{tr('Purchase order')}</th><th scope="col">{tr('Date recorded')}</th><th scope="col" className="right">{tr('Amount')}</th></tr></thead><tbody>
      {invoices.data.map(i=><ClickRow key={i.id} to={`/purchasing/invoices/${i.id}`}><td><Link to={`/purchasing/invoices/${i.id}`}><code>{i.number}</code></Link></td><td>{supplierName(i.supplierId)}</td><td><Link to={`/purchasing/orders/${i.orderId}`}><code>{summaryRows.find(o=>o.orderId===i.orderId)?.number??'—'}</code></Link></td><td className="nowrap">{formatDateTime(i.createdAt,session.org)}</td><td className="right">{money(i.totalMinor,i.currency)}</td></ClickRow>)}
      {!invoices.data.length&&<tr><td colSpan={5} className="muted empty">{tr('No purchase invoices yet.')}</td></tr>}
    </tbody></table></div>
    {/* Billing progress: only orders not yet fully billed, unless the person asks for all (most received orders are fully billed). */}
    <div className="section-head">
      <h2 className="related">{showAll?tr('Received orders and billing progress'):tr('Received orders to bill')} <span className="muted small">({shownBilling.length})</span></h2>
      {billingRows.length>toBill.length&&<Button variant="ghost" size="sm" onClick={()=>setShowAll(!showAll)}>{showAll?tr('Only orders that need attention'):trf('Show all {count} orders',{count:billingRows.length})}</Button>}
    </div>
    <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Purchase order')}</th><th scope="col">{tr('Supplier')}</th><th scope="col" className="right">{tr('Received value')}</th><th scope="col" className="right">{tr('Billed value')}</th><th scope="col" className="right">{tr('Unbilled')}</th><th scope="col">{tr('Status')}</th></tr></thead><tbody>
      {shownBilling.map(({o,received,billed})=><ClickRow key={o.orderId} to={`/purchasing/orders/${o.orderId}`}><td><Link to={`/purchasing/orders/${o.orderId}`}><code>{o.number}</code></Link></td><td>{supplierName(o.supplierId)}</td><td className="right">{money(received,o.currency)}</td><td className="right">{money(billed,o.currency)}</td><td className="right">{money(received-billed,o.currency)}</td><td><Pill status={billed===0?'ordered':billed>=received?'received':'submitted'} label={billed===0?tr('Not billed'):billed>=received?tr('Fully billed'):tr('Part billed')} /></td></ClickRow>)}
      {!shownBilling.length&&<tr><td colSpan={6} className="muted empty">{summaries.data.length?tr('Every received order is fully billed.'):tr('No received purchase orders to bill yet.')}</td></tr>}
    </tbody></table></div>
  </section>;
}

/** One supplier invoice: supplier, purchase order, the billed lines and total, payments made against it, and its history. */
export function SupplierInvoicePage() {
  const id = useParam('id');
  const session = useSession();
  // The invoice by id, with each line's item and the order number (the list holds the newest 250 only).
  const invoice = useLoad(() => api<Omit<Invoice, 'lines'> & { orderNumber: string | null; lines: (BillLine & { itemId: string | null })[] }>(`/v1/purchasing/supplier-invoices/${id}`));
  const suppliers = useLoad(() => api<Supplier[]>('/v1/purchasing/suppliers'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));
  // The supplier's own codes for these items (sql/099), as a "Their code" column when a line has one.
  const theirCodes = codesFor(usePartyCodes('supplier', invoice.data?.supplierId), (invoice.data?.lines ?? []).map((l) => l.itemId ?? undefined));

  if (invoice.error) return <section className="page"><BackLink to="/purchasing/invoices" label={tr('← Purchase invoices')} backLabel={tr('← Back')} /><Loading error={invoice.error} /></section>;
  if (!invoice.data || !suppliers.data || !items.data) return <section className="page"><Loading /></section>;
  const inv = invoice.data;
  const order = { number: inv.orderNumber };
  // VAT (sql/087): shown only when the bill carries any, so bills without VAT look as before.
  const hasVat = (inv.taxMinor ?? 0) > 0 || inv.lines.some((l) => (l.taxRate ?? 0) > 0);
  // Approved supplier notes change what is owed (sql/094); the bill itself is never edited.
  const credited = inv.creditedMinor ?? 0;
  const debited = inv.debitedMinor ?? 0;
  const due = inv.totalMinor - credited + debited;
  const supplier = suppliers.data.find((s) => s.id === inv.supplierId)?.name ?? '—';
  const itemOf = (orderLineId: string) => {
    const itemId = inv.lines.find((l) => l.orderLineId === orderLineId)?.itemId;
    const i = items.data?.find((v) => v.id === itemId);
    return i ? `${i.sku} · ${i.name}` : '—';
  };

  return (
    <section className="page">
      <BackLink to="/purchasing/invoices" label={tr('← Purchase invoices')} backLabel={tr('← Back')} />
      <div className="page-head"><h1 className="mono">{inv.number}</h1></div>
      <dl className="facts">
        <div><dt>{tr('Supplier')}</dt><dd>{supplier}</dd></div>
        <div><dt>{tr('Purchase order')}</dt><dd><Link to={`/purchasing/orders/${inv.orderId}`}><code>{order?.number ?? '—'}</code></Link></dd></div>
        <div><dt>{tr('Invoice date')}</dt><dd>{formatDay(inv.invoiceDate, session.org)}</dd></div>
        {inv.dueDate ? <div><dt>{tr('Due date')}</dt><dd>{formatDay(inv.dueDate, session.org)}</dd></div> : null}
        <div><dt>{tr('Date recorded')}</dt><dd>{formatDateTime(inv.createdAt, session.org)}</dd></div>
        {hasVat ? <div><dt>{tr('Before VAT')}</dt><dd className="amount">{money(inv.netMinor ?? 0, inv.currency)}</dd></div> : null}
        {hasVat ? <div><dt>{inv.vatDeductible ? tr('VAT (deducted)') : tr('VAT (added to the cost of the goods)')}</dt><dd className="amount">{money(inv.taxMinor ?? 0, inv.currency)}</dd></div> : null}
        {hasVat && inv.computedTaxMinor !== undefined && inv.computedTaxMinor !== inv.taxMinor ? <div><dt>{tr('VAT worked out from the lines')}</dt><dd className="amount">{money(inv.computedTaxMinor, inv.currency)}</dd></div> : null}
        <div><dt>{hasVat ? tr('Total with VAT') : tr('Total')}</dt><dd className="amount">{money(inv.totalMinor, inv.currency)}</dd></div>
        {credited > 0 ? <div><dt>{tr('Credited')}</dt><dd className="amount">−{money(credited, inv.currency)}</dd></div> : null}
        {debited > 0 ? <div><dt>{tr('Debited')}</dt><dd className="amount">+{money(debited, inv.currency)}</dd></div> : null}
        {credited > 0 || debited > 0 ? <div><dt>{tr('Amount owed after notes')}</dt><dd className="amount">{money(due, inv.currency)}</dd></div> : null}
        {inv.vatDocumentRef ? <div><dt>{inv.vatClass === 'import' ? tr('Customs declaration number') : tr('Supplier\'s e-invoice number')}</dt><dd><code>{inv.vatDocumentRef}</code></dd></div> : null}
        {inv.supplierTaxNumber ? <div><dt>{tr('Supplier\'s tax number')}</dt><dd><code>{inv.supplierTaxNumber}</code></dd></div> : null}
        {inv.vatClass && inv.vatClass !== 'local' ? <div><dt>{tr('Kind of purchase')}</dt><dd>{inv.vatClass === 'import' ? tr('Import (customs)') : inv.vatClass === 'mixed' ? tr('Mixed (each line has its own)') : tr('Capital asset (equipment, machinery)')}</dd></div> : null}
      </dl>
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{tr('Item')}</th><TheirCodeHeader codes={theirCodes} /><th scope="col" className="right">{tr('Quantity')}</th><th scope="col" className="right">{tr('Unit cost')}</th><th scope="col" className="right">{hasVat ? tr('Before VAT') : tr('Line total')}</th>
          {hasVat ? <><th scope="col" className="right">{tr('VAT rate')}</th><th scope="col" className="right">{tr('VAT')}</th></> : null}</tr></thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.orderLineId}><td>{itemOf(l.orderLineId)}</td><TheirCodeCell codes={theirCodes} itemId={l.itemId ?? undefined} /><td className="right">{l.qty}</td><td className="right">{money(l.unitCostMinor, inv.currency)}</td><td className="right">{money(l.netMinor ?? Math.round(l.qty * l.unitCostMinor), inv.currency)}</td>
              {hasVat ? <><td className="right">{(l.taxRate ?? 0) > 0 ? `${l.taxRate}%` : tr('None')}</td><td className="right">{money(l.taxMinor ?? 0, inv.currency)}</td></> : null}</tr>
          ))}
          <tr><td colSpan={(hasVat ? 5 : 3) + (theirCodes.size ? 1 : 0)} className="right"><strong>{hasVat ? tr('Total with VAT') : tr('Total')}</strong></td><td className="right"><strong>{money(inv.totalMinor, inv.currency)}</strong></td></tr>
        </tbody>
      </table></div>
      <SupplierNotes billId={inv.id} currency={inv.currency} lines={inv.lines} itemOf={itemOf} onChanged={invoice.reload} />
      <PaymentsAgainst field="supplierInvoiceId" id={inv.id} totalMinor={due} currency={inv.currency} />
      <Attachments entityType="supplier_bill" entityId={inv.id} />
      <RecordHistory key={inv.id} id={inv.id} currency={inv.currency} />
    </section>
  );
}

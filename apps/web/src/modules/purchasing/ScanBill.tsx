import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { type BillScanResult, type BillWarning, formatMoney, minorUnitsFor } from '@erp/shared';
import { DateInput } from '../../components/DateInput';
import { Button, buttonVariants } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { useDateGuard } from '../../lib/dateGuard';
import { Link } from '../../lib/router';

// Scan a supplier bill (sql/108; SCANNING_PLAN.md step 1). Photo or PDF → the company's own AI reads it → OUR matching (server) → this
// draft, with every difference in colour. Nothing is saved until the person clicks Save, which uses the normal bill function
// (POST /supplier-invoices → pur_record_supplier_invoice, all its rules); then the file is attached to the new bill.
// A bill whose goods have not arrived cannot be saved (the database refuses it too): the screen offers to receive the goods first.

type Supplier = { id: string; name: string };
const say = (w: BillWarning) => trf(w.text, w.values ?? {});

function Warnings({ list }: { list: BillWarning[] }) {
  if (!list.length) return null;
  return (
    <ul className="scan-warnings">
      {list.map((w, i) => (
        <li key={`${w.code}-${i}`} className={w.code === 'no_received_order' ? 'scan-block' : 'scan-warn'}>
          {say(w)}
        </li>
      ))}
    </ul>
  );
}

export function ScanBill({ suppliers, onSaved }: { suppliers: Supplier[]; onSaved: () => void }) {
  const dates = useDateGuard();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<BillScanResult | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [vat, setVat] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void read(f);
  };

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const currency = result?.order?.currency ?? result?.bill.currency ?? 'EGP';
  const scale = 10 ** minorUnitsFor(currency);

  const fill = (r: BillScanResult, keepTyped: boolean) => {
    setResult(r);
    if (!keepTyped) {
      setNumber(r.draft.number);
      setDate(r.draft.invoiceDate);
      setVat(r.draft.taxMinor === null ? '' : String(r.draft.taxMinor / 10 ** minorUnitsFor(r.order?.currency ?? r.bill.currency ?? 'EGP')));
    }
    setQty(Object.fromEntries(r.draft.lines.map((l) => [l.orderLineId, String(l.qty)])));
  };

  async function read(f: File) {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setSaved(null);
    setError(null);
    setReading(true);
    try {
      const form = new FormData();
      form.append('file', f);
      fill(await api<BillScanResult>('/v1/purchasing/bills/scan', { method: 'POST', body: form }), false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function rematch(supplierId: string | null, orderId: string | null) {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<Omit<BillScanResult, 'extractionId' | 'provider' | 'model' | 'file'>>('/v1/purchasing/bills/match', {
        method: 'POST',
        body: JSON.stringify({ bill: result.bill, supplierId, orderId }),
      });
      fill({ ...result, ...r }, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const blocked = Boolean(result?.warnings.some((w) => w.code === 'no_received_order'));
  const chosen = useMemo(
    () => (result?.orderLines ?? []).flatMap((l) => (Number(qty[l.orderLineId]) > 0 ? [{ orderLineId: l.orderLineId, qty: Number(qty[l.orderLineId]) }] : [])),
    [result, qty],
  );

  async function save() {
    if (!result?.draft.supplierId || !result.order || !file) return;
    setBusy(true);
    setError(null);
    try {
      const taxMinor = vat.trim() === '' ? undefined : Math.round(Number(vat) * scale);
      const bill = await api<{ id: string; number: string }>('/v1/purchasing/supplier-invoices', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: result.draft.supplierId,
          orderId: result.order.id,
          number: number.trim(),
          invoiceDate: date,
          lines: chosen,
          vat: {
            ...(taxMinor !== undefined && Number.isFinite(taxMinor) ? { taxMinor } : {}),
            ...(result.bill.supplierTaxNumber ? { supplierTaxNumber: result.bill.supplierTaxNumber } : {}),
          },
        }),
      });
      let note = trf('Bill {number} saved. The photo is attached to it.', { number: bill.number });
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('entityType', 'supplier_bill');
        form.append('entityId', bill.id);
        await api('/v1/core/attachments', { method: 'POST', body: form });
      } catch (e) {
        note = trf('Bill {number} saved, but the photo could not be attached: {reason}', { number: bill.number, reason: (e as Error).message });
      }
      setSaved(note);
      setResult(null);
      setFile(null);
      setPreview(null);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const billLineFor = (orderLineId: string) => result?.lines.find((l) => l.orderLineId === orderLineId);
  const unmatched = result?.lines.filter((l) => !l.orderLineId) ?? [];

  return (
    <div className="stack">
      <p className="muted small">
        {tr('Take a photo of the bill or choose a PDF. Your company’s AI reads it and fills in a draft. Check it, then save. Nothing is saved before you click Save.')}
      </p>
      <div className="form-row">
        <Button variant="outline" disabled={reading || busy} onClick={() => cameraRef.current?.click()}>
          {tr('Take a photo')}
        </Button>
        <Button variant="outline" disabled={reading || busy} onClick={() => fileRef.current?.click()}>
          {tr('Choose a picture or PDF')}
        </Button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={pick} />
      </div>
      {reading ? <p className="notice">{tr('Reading the bill…')}</p> : null}
      {saved ? <p className="notice">{saved}</p> : null}
      {error ? (
        <p className="error notice" role="alert">
          {error}
        </p>
      ) : null}
      {preview || result ? (
        <div className="scan-grid">
          <div className="scan-photo">
            {preview && file?.type === 'application/pdf' ? (
              <object data={preview} type="application/pdf" aria-label={tr('The scanned bill')}>
                <a href={preview} target="_blank" rel="noreferrer">
                  {tr('Open the PDF')}
                </a>
              </object>
            ) : preview ? (
              <img src={preview} alt={tr('The scanned bill')} />
            ) : null}
          </div>
          {result ? (
            <div className="stack">
              <p className="muted small">{trf('Read by {provider} ({model}). Check every value.', { provider: result.provider, model: result.model })}</p>
              <Warnings list={result.warnings} />
              {blocked && result.waitingOrders.length ? (
                <div className="form-row">
                  {result.waitingOrders.map((o) => (
                    <Link key={o.id} className={buttonVariants({ variant: 'outline', size: 'sm' })} to={`/purchasing/orders/${o.id}`}>
                      {trf('Receive the goods of {order}', { order: o.number })}
                    </Link>
                  ))}
                </div>
              ) : null}
              <div className="form-row">
                <label>
                  {tr('Supplier')}
                  <select value={result.draft.supplierId ?? ''} disabled={busy} onChange={(e) => rematch(e.target.value || null, null)}>
                    <option value="">{tr('Choose the supplier…')}</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                {result.orders.length ? (
                  <label>
                    {tr('Received purchase order')}
                    <select value={result.order?.id ?? ''} disabled={busy} onChange={(e) => rematch(result.draft.supplierId, e.target.value || null)}>
                      {result.orders.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.number}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="form-row">
                <label>
                  {tr("Supplier's invoice number")}
                  <input value={number} onChange={(e) => setNumber(e.target.value)} required />
                </label>
                <label>
                  {tr('Invoice date')}
                  <DateInput value={date} onChange={(e) => setDate(e.target.value)} required onBad={dates.watch('billDate')} />
                </label>
                <label>
                  {trf('VAT on the bill ({currency})', { currency })}
                  <input type="number" min="0" step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} />
                </label>
              </div>
              {result.orderLines.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{tr('Item')}</th>
                        <th scope="col">{tr('The bill says')}</th>
                        <th scope="col" className="right">
                          {tr('Received, not billed')}
                        </th>
                        <th scope="col" className="right">
                          {tr('Order price')}
                        </th>
                        <th scope="col">{tr('Quantity on this invoice')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.orderLines.map((ol) => {
                        const bl = billLineFor(ol.orderLineId);
                        const left = Math.round((ol.receivedQty - ol.billedQty) * 1000) / 1000;
                        return (
                          <tr key={ol.orderLineId} className={bl?.warnings.length ? 'scan-row-warn' : undefined}>
                            <td>
                              {ol.sku} · {ol.name}
                            </td>
                            <td>
                              {bl ? (
                                <>
                                  {bl.line.description}
                                  {bl.line.qty !== null ? ` · ${bl.line.qty}` : ''}
                                  {bl.line.unitPrice !== null ? ` × ${bl.line.unitPrice}` : ''}
                                  <Warnings list={bl.warnings} />
                                </>
                              ) : (
                                <span className="muted">{tr('Not on the bill')}</span>
                              )}
                            </td>
                            <td className="right">{left}</td>
                            <td className="right">{formatMoney({ amountMinor: ol.unitCostMinor, currency })}</td>
                            <td>
                              <input
                                aria-label={trf('Quantity billed for {item}', { item: `${ol.sku} · ${ol.name}` })}
                                type="number"
                                min="0"
                                max={left}
                                step="0.001"
                                value={qty[ol.orderLineId] ?? ''}
                                onChange={(e) => setQty((q) => ({ ...q, [ol.orderLineId]: e.target.value }))}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {unmatched.length ? (
                <div className="stack">
                  <h3>{tr('Lines on the bill that are not on the order')}</h3>
                  <ul className="scan-warnings">
                    {unmatched.map((l) => (
                      <li key={l.index} className="scan-warn">
                        {l.line.itemCode ? `${l.line.itemCode} · ` : ''}
                        {l.line.description}
                        {l.line.qty !== null ? ` · ${l.line.qty}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="form-row">
                <Button disabled={busy || blocked || !result.order || !result.draft.supplierId || !number.trim() || !date || !chosen.length || dates.blocked} onClick={save}>
                  {busy ? tr('Saving…') : tr('Save the bill')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setResult(null);
                    setFile(null);
                    setPreview(null);
                  }}
                >
                  {tr('Discard')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { ErrorToast } from '../../components/Toast';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { demoMode } from '../../lib/demo';
import { SearchSelect } from '../../components/SearchSelect';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { Link, navigate } from '../../lib/router';
import { emptyLine, LineUnitHint, LineVatPreview, QuickAddParty, useOrderForm, type Line, type OrderFormProps } from './common';
import '../sales/pagekit.css';
import './form.css';

// The new UI's order form (sales and purchase orders). Same logic as the old form (useOrderForm in common.tsx): prices, units, VAT,
// checks and saving are shared; only the layout is new. Loaded only when the new UI is on (lib/uiMode.ts).
export function OrderFormNew(props: OrderFormProps) {
  const { cat, parties, link, partyId, setPartyId, quickAdd, setQuickAdd, canQuickAdd, warehouseId, setWarehouseId, lines, setLines, error, setError, busy, setLine, currency, partyCodes, vatOn, baseUnitOf, unitsOf, factorOf, defaultUnitOf, saved, money2, submit, scanning, setScanning, scanned, addScanned } = useOrderForm(props);
  const layout = useLabChoice('form', ['A', 'B', 'C'] as const, 'A');
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState('');
  if (!cat.ready || !parties.data) return <section className="page"><Loading /></section>;

  // New UI (plan of 23 Nov 2026): three layouts of the same form, being decided by Ben and Grant (Design Lab "Form page"). Everything
  // above this line (prices, units, VAT, checks, saving) is shared and unchanged.
  //   A  Document entry (Dynamics): action bar, General section, the lines as one grid, totals under the lines.
  //   B  Guided: who and where, then the items, then a review, then save.
  //   C  Quick entry: type an item to add a line; the running total stays in a bar at the bottom.
  const chosen = lines.filter((l) => l.itemId);
  const lineTotal = (l: Line) => {
    const b = saved(l);
    return Number.isFinite(b.baseQty * b.baseMinor) ? b.baseQty * b.baseMinor : 0;
  };
  const total = chosen.reduce((s, l) => s + lineTotal(l), 0);
  const itemOptions = (cat.items.data ?? []).map((it) => {
    const theirs = partyCodes.get(it.id);
    return { value: it.id, label: theirs ? `${it.sku} · ${it.name} · (${theirs})` : `${it.sku} · ${it.name}`, keywords: `${it.nameAr ?? ''} ${theirs ?? ''}` };
  });
  const itemName = (id: string) => (cat.items.data ?? []).find((it) => it.id === id)?.name ?? '';
  const priceHead = `${vatOn ? (props.vat?.pricesIncludeVat ? trf('{label} including VAT', { label: props.priceLabel }) : trf('{label} before VAT', { label: props.priceLabel })) : props.priceLabel} (${currency})`;
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, n) => n !== i) : [emptyLine()]));
  const partyField = (
    <label className="fm-field">
      <span className="fm-label">{tr(props.partyLabel)}</span>
      <span className="fm-inline">
        <SearchSelect required value={partyId} onChange={setPartyId} label={tr(props.partyLabel)}
          options={parties.data.map((p) => ({ value: p.id, label: p.code ? `${p.code} · ${p.name}` : p.name, keywords: `${p.phone ?? ''} ${p.city ?? ''} ${p.contact ?? ''}` }))} />
        {canQuickAdd ? <Button type="button" variant="outline" size="sm" onClick={() => setQuickAdd(true)}>{tr('+ New')}</Button> : null}
      </span>
      {link.itemId && !partyId ? <span className="notice small" role="status">{trf('Choose a {party}.', { party: tr(props.partyLabel).toLowerCase() })}</span> : null}
    </label>
  );
  const warehouseField = (
    <label className="fm-field">
      <span className="fm-label">{tr('Warehouse')}</span>
      <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
        {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </label>
  );
  const unitPicker = (l: Line, i: number) =>
    l.itemId && unitsOf(l.itemId).length ? (
      <select aria-label={tr('Unit')} className="unit-select" value={l.unit}
        onChange={(e) => {
          const unit = e.target.value;
          const price = l.suggested && l.suggestedBase !== undefined ? ((l.suggestedBase * factorOf(l.itemId, unit)) / 100).toFixed(2) : l.price;
          setLine(i, { unit, price });
        }}>
        <option value="">{tr(baseUnitOf(l.itemId))}</option>
        {unitsOf(l.itemId).map((u) => <option key={u.unit} value={u.unit}>{trf('{unit} ({factor} {base})', { unit: tr(u.unit), factor: u.factor, base: tr(baseUnitOf(l.itemId)) })}</option>)}
      </select>
    ) : null;
  const lineExtras = (l: Line) => (
    <>
      {l.suggested ? <span className="hint muted">{tr('Suggested price; you can change it.')}</span> : null}
      {l.itemId && l.unit ? <LineUnitHint b={saved(l)} unit={tr(l.unit)} base={tr(baseUnitOf(l.itemId))} money={money2} /> : null}
      {vatOn ? <LineVatPreview itemId={l.itemId} qty={saved(l).baseQty} priceMinor={saved(l).baseMinor} vat={props.vat!} items={cat.items.data ?? []} currency={currency} /> : null}
    </>
  );
  // The lines as one grid: item, quantity and unit, price, line total, remove.
  const grid = (withPicker: boolean) => (
    <div className="fm-grid" role="table" aria-label={tr('Items')}>
      <div className="fm-grow fm-ghead" role="row">
        <span role="columnheader">{tr('Item')}</span><span role="columnheader">{tr('Quantity')}</span><span role="columnheader">{priceHead}</span>
        <span role="columnheader" className="pk-num">{tr('Line total')}</span><span role="columnheader" className="pk-visually-hidden">{tr('Remove')}</span>
      </div>
      {lines.map((l, i) => (
        <div className="fm-grow" role="row" key={i}>
          <span role="cell">
            {withPicker ? <SearchSelect value={l.itemId} onChange={(v) => setLine(i, { itemId: v, unit: defaultUnitOf(v) })} label={tr('Item')} placeholder={tr('Choose an item…')} options={itemOptions} /> : <strong>{itemName(l.itemId)}</strong>}
          </span>
          <span role="cell" className="fm-inline"><input inputMode="decimal" aria-label={tr('Quantity')} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />{unitPicker(l, i)}</span>
          <span role="cell"><input inputMode="decimal" aria-label={priceHead} placeholder="0.00" value={l.price} onChange={(e) => setLine(i, { price: e.target.value, suggested: false })} /></span>
          <span role="cell" className="pk-num">{l.itemId ? money2(lineTotal(l)) : ''}</span>
          <span role="cell"><button type="button" className="fm-remove" aria-label={tr('Remove')} onClick={() => removeLine(i)}>✕</button></span>
          <span className="fm-extras">{lineExtras(l)}</span>
        </div>
      ))}
    </div>
  );
  const totals = <div className="pk-totals"><span>{tr('Total')}</span><strong className="pk-num">{money2(total)}</strong></div>;
  const quickAddModal = quickAdd ? (
    <QuickAddParty title={props.partyField === 'customerId' ? tr('New customer') : tr('New supplier')} endpoint={props.partyEndpoint}
      onClose={() => setQuickAdd(false)} onAdded={(id) => { setQuickAdd(false); setPartyId(id); parties.reload(); }} />
  ) : null;
  const errorToast = <ErrorToast message={error} onClose={() => setError(null)} />;
  // Scanning step 2 (sql/108) in the new UI too: the same addScanned as the old form; not in the sample build.
  const scanButton = demoMode ? null : <button type="button" className="fm-add" onClick={() => setScanning(true)}>{tr('Scan a barcode')}</button>;
  const scanUi = <>{scanned ? <p className="notice small" role="status">{scanned}</p> : null}{scanning ? <BarcodeScanner onCode={(code) => void addScanned(code)} onClose={() => setScanning(false)} /> : null}</>;

  if (layout === 'B') {
    const STEPS = [tr(props.partyLabel), tr('Items'), tr('Review')];
    const canNext = step === 0 ? Boolean(partyId && warehouseId) : step === 1 ? chosen.length > 0 : true;
    return (
      <section className="page pk fm">
        <Link to={props.backTo} className="back-link">← {props.backLabel}</Link>
        <h1>{props.title}</h1>
        <ol className="pk-steps fm-steps">{STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'current' : ''}>{i + 1}. {s}</li>)}</ol>
        <form className="fm-body" onSubmit={(e) => { if (step < 2) { e.preventDefault(); if (canNext) setStep(step + 1); } else void submit(e); }}>
          {step === 0 && <div className="fm-two">{partyField}{warehouseField}</div>}
          {step === 1 && <>{grid(true)}<button type="button" className="fm-add" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ {tr('Add another item')}</button>{scanButton}{scanUi}{totals}</>}
          {step === 2 && (
            <>
              <dl className="pk-grid">
                <div><dt>{tr(props.partyLabel)}</dt><dd>{parties.data.find((p) => p.id === partyId)?.name}</dd></div>
                <div><dt>{tr('Warehouse')}</dt><dd>{cat.warehouses.data?.find((w) => w.id === warehouseId)?.name}</dd></div>
              </dl>
              <table className="pk-table">
                <thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="pk-num">{tr('Quantity')}</th><th scope="col" className="pk-num">{tr('Line total')}</th></tr></thead>
                <tbody>{chosen.map((l, i) => <tr key={i}><td>{itemName(l.itemId)}</td><td className="pk-num">{l.qty} {l.unit ? tr(l.unit) : tr(baseUnitOf(l.itemId))}</td><td className="pk-num">{money2(lineTotal(l))}</td></tr>)}</tbody>
              </table>
              {totals}
            </>
          )}
          {errorToast}
          <div className="fm-foot">
            {step > 0 && <button type="button" className="pk-act" onClick={() => setStep(step - 1)}>← {tr('Back')}</button>}
            <button type="submit" className="pk-act pk-act-main" disabled={busy || !canNext}>{step < 2 ? tr('Next') : busy ? tr('Saving…') : props.submitLabel}</button>
          </div>
        </form>
        {quickAddModal}
      </section>
    );
  }
  if (layout === 'C') {
    const addItem = (v: string) => {
      if (!v) return;
      setLines((ls) => [...ls.filter((l) => l.itemId), { ...emptyLine(), itemId: v, unit: defaultUnitOf(v) }]);
      setPick('');
    };
    return (
      <section className="page pk fm fm-c">
        <Link to={props.backTo} className="back-link">← {props.backLabel}</Link>
        <h1>{props.title}</h1>
        <form className="fm-body" onSubmit={submit}>
          <div className="fm-two">{partyField}{warehouseField}</div>
          <label className="fm-field fm-quick">
            <span className="fm-label">{tr('Add an item')}</span>
            <SearchSelect value={pick} onChange={addItem} label={tr('Add an item')} placeholder={tr('Type an item name or code, then pick it')} options={itemOptions} />
          </label>
          {scanButton}{scanUi}
          {chosen.length ? grid(false) : <p className="pk-empty">{tr('No items yet. Type above to add the first one.')}</p>}
          {errorToast}
          <div className="fm-sticky">
            <span>{trf('{n} items', { n: chosen.length })}</span>
            <span className="fm-sticky-total">{money2(total)}</span>
            <button type="submit" className="pk-act pk-act-main" disabled={busy}>{busy ? tr('Saving…') : props.submitLabel}</button>
          </div>
        </form>
        {quickAddModal}
      </section>
    );
  }
  return (
    <section className="page pk fm">
      <form className="fm-body" onSubmit={submit}>
        <div className="pk-head"><h1>{props.title}</h1></div>
        <div className="pk-bar" role="toolbar" aria-label={tr('Actions')}>
          <button type="submit" className="pk-act pk-act-main" disabled={busy}>{busy ? tr('Saving…') : props.submitLabel}</button>
          <button type="button" className="pk-act" onClick={() => navigate(props.backTo)}>{tr('Cancel')}</button>
        </div>
        <section className="pk-section"><h2>{tr('General')}</h2><div className="fm-two">{partyField}{warehouseField}</div></section>
        <section className="pk-section">
          <h2>{tr('Lines')}</h2>
          {grid(true)}
          <button type="button" className="fm-add" onClick={() => setLines((ls) => [...ls, emptyLine()])}>+ {tr('Add a line')}</button>
          {scanButton}{scanUi}
          {totals}
        </section>
        {errorToast}
      </form>
      {quickAddModal}
    </section>
  );
}


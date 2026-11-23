import { useState } from 'react';
import { Loading } from '../../components/Loading';
import { ErrorToast } from '../../components/Toast';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { localName } from '../../lib/names';
import { parseAmount } from '../../lib/numbers';
import { Link } from '../../lib/router';
import { useNewRequest } from './RequestPages';
import '../sales/pagekit.css';
import '../trade/form.css';
import './clerk.css';

// The new UI's "Send goods out", built for the warehouse clerk on a phone (three layouts being decided, Design Lab "Send goods out").
// Same logic as the old form (useNewRequest in RequestPages.tsx); a manager still approves before the goods leave.
//   A  Phone form: big fields stacked, the Submit bar fixed at the bottom.
//   B  Steps: from where, what, why (one-tap reasons), send.
//   C  Items first: pick an item to add it, - / + to change the quantity, warehouse as one-tap choices.
export function NewRequestNew() {
  const { cat, stock, past, warehouseId, setWarehouseId, reason, setReason, lines, setLines, error, setError, busy, available, setLine, submit } = useNewRequest();
  const layout = useLabChoice('clerk', ['A', 'B', 'C'] as const, 'A');
  const [step, setStep] = useState(0);
  if (!cat.ready || !stock.data || !past.data) return <section className="page"><Loading /></section>;

    const chosen = lines.filter((l) => l.itemId);
    const REASONS = [tr('Customer order'), tr('Internal use'), tr('Damaged'), tr('Transfer to a branch')];
    const bump = (i: number, d: number) => setLine(i, { qty: String(Math.max(1, (parseAmount(lines[i]?.qty ?? '1') || 0) + d)) });
    const warehousePick = (
      <div className="ck-chips" role="radiogroup" aria-label={tr('Issue from warehouse')}>
        {cat.warehouses.data?.map((w) => (
          <button key={w.id} type="button" role="radio" aria-checked={w.id === warehouseId} className="ck-chip" onClick={() => setWarehouseId(w.id)}>{localName(w)}</button>
        ))}
      </div>
    );
    const reasonPick = (
      <>
        <div className="ck-chips">{REASONS.map((r) => <button key={r} type="button" className="ck-chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}</div>
        <input className="ck-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Or type the reason')} aria-label={tr('Reason')} />
      </>
    );
    const itemRows = (withSelect: boolean) => (
      <ul className="ck-items">
        {lines.map((l, i) => (
          <li key={i}>
            {withSelect ? (
              <select className="ck-input" value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })} aria-label={tr('Item')}>
                <option value="">{tr('Choose an item…')}</option>
                {cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
              </select>
            ) : <strong>{cat.items.data?.find((it) => it.id === l.itemId)?.name}</strong>}
            {l.itemId && <span className="ck-avail">{trf('({n} available)', { n: available(l.itemId) })}</span>}
            <span className="ck-qty">
              <button type="button" aria-label={tr('Less')} onClick={() => bump(i, -1)}>−</button>
              <input inputMode="decimal" aria-label={tr('Quantity')} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
              <button type="button" aria-label={tr('More')} onClick={() => bump(i, 1)}>+</button>
            </span>
          </li>
        ))}
      </ul>
    );
    const submitBar = (label: string, disabled = false) => (
      <div className="ck-bar">
        <span>{trf('{n} items', { n: chosen.length })}{reason ? ` · ${reason}` : ''}</span>
        <button type="submit" className="pk-act pk-act-main ck-send" disabled={busy || disabled}>{busy ? tr('Submitting…') : label}</button>
      </div>
    );
    const note = <p className="pk-muted">{tr('Your manager approves before the goods leave. The quantities are kept for you until they decide.')}</p>;
    if (layout === 'B') {
      const canNext = step === 0 ? Boolean(warehouseId) : step === 1 ? chosen.length > 0 : reason.trim() !== '';
      const Q = [tr('From which warehouse?'), tr('What goes out?'), tr('Why?')];
      return (
        <section className="page pk ck">
          <Link to="/inventory/requests" className="back-link">← {tr('Stock requests')}</Link>
          <p className="pk-label">{trf('Step {n} of {total}', { n: step + 1, total: 3 })}</p>
          <h1 className="ck-q">{Q[step]}</h1>
          <form className="ck-body" onSubmit={(e) => { if (step < 2) { e.preventDefault(); if (canNext) setStep(step + 1); } else void submit(e); }}>
            {step === 0 && warehousePick}
            {step === 1 && <>{itemRows(true)}<button type="button" className="fm-add" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])}>+ {tr('Add another item')}</button></>}
            {step === 2 && <>{reasonPick}{note}</>}
            <ErrorToast message={error} onClose={() => setError(null)} />
            <div className="ck-bar">
              {step > 0 ? <button type="button" className="pk-act" onClick={() => setStep(step - 1)}>← {tr('Back')}</button> : <span />}
              <button type="submit" className="pk-act pk-act-main ck-send" disabled={busy || !canNext}>{step < 2 ? tr('Next') : busy ? tr('Submitting…') : tr('Submit for approval')}</button>
            </div>
          </form>
        </section>
      );
    }
    if (layout === 'C') {
      return (
        <section className="page pk ck">
          <Link to="/inventory/requests" className="back-link">← {tr('Stock requests')}</Link>
          <h1>{tr('Send goods out')}</h1>
          <form className="ck-body" onSubmit={submit}>
            <p className="pk-label">{tr('From')}</p>
            {warehousePick}
            <p className="pk-label">{tr('Add an item')}</p>
            <select className="ck-input ck-add" value="" aria-label={tr('Add an item')}
              onChange={(e) => { const v = e.target.value; if (v) setLines((ls) => [...ls.filter((x) => x.itemId), { itemId: v, qty: '1' }]); }}>
              <option value="">{tr('Choose an item to add…')}</option>
              {cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
            </select>
            {chosen.length ? itemRows(false) : <p className="pk-empty">{tr('No items yet.')}</p>}
            <p className="pk-label">{tr('Why')}</p>
            {reasonPick}
            <ErrorToast message={error} onClose={() => setError(null)} />
            {submitBar(tr('Submit for approval'), !reason.trim())}
          </form>
        </section>
      );
    }
    return (
      <section className="page pk ck">
        <Link to="/inventory/requests" className="back-link">← {tr('Stock requests')}</Link>
        <h1>{tr('Send goods out')}</h1>
        {note}
        <form className="ck-body" onSubmit={submit}>
          <label className="ck-field"><span>{tr('Issue from warehouse')}</span>
            <select className="ck-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{localName(w)}</option>)}
            </select>
          </label>
          <p className="pk-label">{tr('Items')}</p>
          {itemRows(true)}
          <button type="button" className="fm-add" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])}>+ {tr('Add another item')}</button>
          <label className="ck-field"><span>{tr('Reason')}</span><input className="ck-input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Customer order, internal use…')} /></label>
          <ErrorToast message={error} onClose={() => setError(null)} />
          {submitBar(tr('Submit for approval'))}
        </form>
      </section>
    );
}

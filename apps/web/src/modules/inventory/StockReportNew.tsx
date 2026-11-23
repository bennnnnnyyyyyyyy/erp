import { useMemo, useState } from 'react';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import type { StockRow } from '../../lib/demoInventory';
import { tr, trf } from '../../lib/i18n';
import { useLabChoice } from '../../lib/labChoice';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useCatalog } from '../trade/common';
import '../sales/pagekit.css';

// New UI (plan of 23 Nov 2026): the report page in three versions, shown on stock on hand by warehouse (Design Lab "Report page").
// Reads the existing endpoints only: GET /v1/inventory/stock, /items, /warehouses. Nothing is saved.
//   A  Dynamics report: filters on top, "updated at", a figures strip, then folding groups per warehouse with subtotals.
//   B  Read first: what the numbers say in plain sentences, then what needs attention, then the full table.
//   C  Chart first: one bar per item (available and reserved, the reorder level marked), the table folded below.
const VERSIONS = ['A', 'B', 'C'] as const;
type Filter = 'all' | 'low' | 'out';

export function StockReportNew() {
  const version = useLabChoice('report', VERSIONS, 'A');
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const [wh, setWh] = useState('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [loadedAt] = useState(() => new Date());
  const items = cat.items.data ?? [];
  const item = (id: string) => items.find((i) => i.id === id);
  const isLow = (r: StockRow) => {
    const lvl = item(r.itemId)?.reorderLevel;
    return lvl !== null && lvl !== undefined && r.available <= lvl;
  };
  const rows = useMemo(
    () => (stock.data ?? []).filter((r) => (wh === 'all' || r.warehouseId === wh) && (filter === 'all' || (filter === 'low' ? isLow(r) : r.available <= 0))),
    // biome-ignore lint/correctness/useExhaustiveDependencies: isLow reads the catalog, listed
    [stock.data, wh, filter, cat.items.data],
  );
  if (stock.error) return <section className="page"><p className="error">{stock.error}</p></section>;
  if (!stock.data || !cat.ready) return <section className="page"><Loading /></section>;

  const warehouses = cat.warehouses.data ?? [];
  const sum = (rs: StockRow[], k: 'onHand' | 'reserved' | 'available') => rs.reduce((s, r) => s + r[k], 0);
  const itemsCount = new Set(rows.map((r) => r.itemId)).size;
  const low = rows.filter(isLow);
  const out = rows.filter((r) => r.available <= 0);
  const fmt = (n: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(n);
  const unit = (id: string) => cat.uomOf(id);
  const filters = (
    <div className="pk-bar" role="toolbar" aria-label={tr('Filters')}>
      <label className="rp-chip"><span>{tr('Warehouse')}</span>
        <select value={wh} onChange={(e) => setWh(e.target.value)}><option value="all">{tr('All warehouses')}</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      </label>
      <label className="rp-chip"><span>{tr('Show')}</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}><option value="all">{tr('All items')}</option><option value="low">{tr('Low on stock')}</option><option value="out">{tr('Out of stock')}</option></select>
      </label>
      <span className="pk-bar-gap" />
      <span className="pk-muted">{trf('Updated {time}', { time: loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>
      <button type="button" className="pk-act" onClick={() => stock.reload()}>↻ {tr('Refresh')}</button>
    </div>
  );
  const table = (rs: StockRow[]) => (
    <table className="pk-table">
      <thead><tr><th scope="col">{tr('Item')}</th><th scope="col">{tr('Warehouse')}</th><th scope="col" className="pk-num">{tr('On hand')}</th><th scope="col" className="pk-num">{tr('Reserved')}</th><th scope="col" className="pk-num">{tr('Available')}</th></tr></thead>
      <tbody>
        {rs.map((r) => (
          <tr key={`${r.itemId}:${r.warehouseId}`} className={isLow(r) ? 'rp-low' : undefined}>
            <td><Link to={`/inventory/items/${r.itemId}`}>{item(r.itemId)?.name ?? r.itemId}</Link> <span className="pk-muted">{item(r.itemId)?.sku}</span></td>
            <td>{cat.warehouseName(r.warehouseId)}</td>
            <td className="pk-num">{fmt(r.onHand)} {unit(r.itemId)}</td>
            <td className="pk-num">{fmt(r.reserved)}</td>
            <td className="pk-num"><strong>{fmt(r.available)}</strong>{isLow(r) && <span className="rp-flag">{tr('Low')}</span>}</td>
          </tr>
        ))}
        {rs.length === 0 && <tr><td colSpan={5} className="pk-empty">{tr('Nothing matches these filters.')}</td></tr>}
      </tbody>
    </table>
  );
  const strip = (
    <div className="pk-strip">
      <div><span>{tr('Items')}</span><strong>{itemsCount}</strong></div>
      <div><span>{tr('On hand')}</span><strong>{fmt(sum(rows, 'onHand'))}</strong></div>
      <div><span>{tr('Reserved')}</span><strong>{fmt(sum(rows, 'reserved'))}</strong></div>
      <div><span>{tr('Low on stock')}</span><strong>{low.length}</strong></div>
    </div>
  );

  if (version === 'B') {
    return (
      <section className="page pk pk-wide">
        <div className="pk-head"><div><p className="pk-kind">{tr('Report')}</p><h1>{tr('Stock on hand')}</h1></div></div>
        {filters}
        <div className="rp-read">
          <p>{trf('You hold {items} items in {wh} warehouses: {onHand} units on hand, of which {reserved} are set aside for requests.', { items: itemsCount, wh: wh === 'all' ? warehouses.length : 1, onHand: fmt(sum(rows, 'onHand')), reserved: fmt(sum(rows, 'reserved')) })}</p>
          <p>{low.length ? trf('{n} lines are at or below their reorder level ({out} of them empty).', { n: low.length, out: out.length }) : tr('Nothing is below its reorder level.')}</p>
        </div>
        {low.length > 0 && <><h2 className="pk-h2">{tr('Needs attention')}</h2>{table(low)}</>}
        <h2 className="pk-h2">{tr('Everything')}</h2>
        {table(rows)}
      </section>
    );
  }
  if (version === 'C') {
    const max = Math.max(1, ...rows.map((r) => r.onHand));
    return (
      <section className="page pk pk-wide">
        <div className="pk-head"><div><p className="pk-kind">{tr('Report')}</p><h1>{tr('Stock on hand')}</h1></div></div>
        {filters}
        <div className="rp-legend"><span className="rp-key rp-key-av" />{tr('Available')}<span className="rp-key rp-key-res" />{tr('Reserved')}<span className="rp-key rp-key-lvl" />{tr('Reorder level')}</div>
        <ul className="rp-bars">
          {rows.map((r) => {
            const lvl = item(r.itemId)?.reorderLevel;
            return (
              <li key={`${r.itemId}:${r.warehouseId}`} className={isLow(r) ? 'rp-low' : undefined}>
                <span className="rp-bar-name">{item(r.itemId)?.name} <span className="pk-muted">· {cat.warehouseName(r.warehouseId)}</span></span>
                <span className="rp-track" aria-hidden="true">
                  <i className="rp-av" style={{ width: `${(Math.max(r.available, 0) / max) * 100}%` }} />
                  <i className="rp-res" style={{ width: `${(r.reserved / max) * 100}%` }} />
                  {lvl ? <b className="rp-lvl" style={{ insetInlineStart: `${Math.min(lvl / max, 1) * 100}%` }} /> : null}
                </span>
                <span className="pk-num rp-bar-n">{fmt(r.available)} / {fmt(r.onHand)} {unit(r.itemId)}</span>
              </li>
            );
          })}
        </ul>
        <details className="pk-fold"><summary>{tr('Show the table')}</summary>{table(rows)}</details>
      </section>
    );
  }
  const groups = warehouses.filter((w) => wh === 'all' || w.id === wh).map((w) => ({ w, rs: rows.filter((r) => r.warehouseId === w.id) })).filter((g) => g.rs.length);
  return (
    <section className="page pk pk-wide">
      <div className="pk-head"><div><p className="pk-kind">{tr('Report')}</p><h1>{tr('Stock on hand by warehouse')}</h1></div></div>
      {filters}
      {strip}
      {groups.map((g) => (
        <details key={g.w.id} className="pk-fold rp-group" open>
          <summary><span>{g.w.name}</span><span className="pk-muted">{trf('{n} lines · {onHand} on hand · {available} available', { n: g.rs.length, onHand: fmt(sum(g.rs, 'onHand')), available: fmt(sum(g.rs, 'available')) })}</span></summary>
          {table(g.rs)}
        </details>
      ))}
      {groups.length === 0 && <p className="pk-empty">{tr('Nothing matches these filters.')}</p>}
    </section>
  );
}

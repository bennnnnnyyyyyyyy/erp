import { useState, type CSSProperties } from 'react';
import { formatMoney, hasPermission } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { RecordHistory } from '../../components/RecordHistory';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import type { DemoItem, LedgerMove, StockRow } from '../../lib/demoInventory';
import { formatDateTime, formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { usePeople } from '../../lib/people';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { EditItemModal, MOVE_KIND_LABEL, useCatalog } from './Inventory';

// One page per item (inventory redesign Q1, Ben 10 Nov 2026). Everything the app knows about one item, which used to be spread over
// six screens: totals, stock per warehouse, its movements, batches, units, average cost and its history. Read-only apart from Edit;
// the actions open the existing screens.

type Tab = 'stock' | 'moves' | 'batches' | 'units' | 'cost' | 'history';
type Unit = { id: string; unit: string; factor: number; forPurchase: boolean; forSale: boolean };
type Batch = { id: string; itemId: string; batchNo: string; expiryDate: string | null; status: string; stock?: { warehouseId: string; qty: number }[] };
type Cost = { itemId: string; avgCostMinor: number | null; onHand: number; valueMinor: number | null };
type Forecast = { itemId: string; runsOutOn: string | null; dailyRate: number; daysOfCover: number | null };

const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
/** A list that may not exist for this person or in the demo: an error just means "nothing to show". */
const optional = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);

export function ItemPage() {
  const id = useParam('id');
  const session = useSession();
  const who = usePeople();
  const cat = useCatalog();
  const can = (key: string) => hasPermission(session.permissions, key);
  const isManager = session.role === 'owner' || session.role === 'admin';
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const moves = useLoad(() => api<LedgerMove[]>(`/v1/inventory/ledger?itemId=${id}`));
  const units = useLoad(() => (demoMode ? Promise.resolve([] as Unit[]) : optional(api<Unit[]>(`/v1/inventory/items/${id}/units`))));
  const batches = useLoad(() => (demoMode || !can('inventory.batches.read') ? Promise.resolve([] as Batch[]) : optional(api<Batch[]>('/v1/inventory/batches'))));
  const costs = useLoad(() => (demoMode || !isManager ? Promise.resolve([] as Cost[]) : optional(api<Cost[]>('/v1/inventory/item-costs'))));
  const forecast = useLoad(() =>
    demoMode || !can('inventory.forecast.read') ? Promise.resolve([] as Forecast[]) : optional(api<Forecast[]>('/v1/inventory/forecast')),
  );
  const [tab, setTab] = useState<Tab>('stock');
  const [editing, setEditing] = useState(false);

  const item = cat.items.data?.find((i) => i.id === id) as (DemoItem & { tracksBatches?: boolean }) | undefined;
  if (cat.items.error) return <section className="page"><p className="error">{cat.items.error}</p></section>;
  if (!cat.ready || !stock.data) return <section className="page"><Loading /></section>;
  if (!item) return <section className="page"><Link to="/inventory" className="back-link">{tr('← Stock on hand')}</Link><p className="error">{tr('Item not found')}</p></section>;

  const rows = (stock.data ?? []).filter((s) => s.itemId === id);
  const sum = (f: (s: StockRow) => number) => rows.reduce((a, s) => a + f(s), 0);
  const onHand = sum((s) => s.onHand);
  const reserved = sum((s) => s.reserved);
  const available = sum((s) => s.available);
  const cost = costs.data?.find((c) => c.itemId === id);
  const fc = forecast.data?.find((f) => f.itemId === id);
  const itemMoves = (moves.data ?? []).filter((m) => m.itemId === id);
  const itemBatches = (batches.data ?? []).filter((b) => b.itemId === id);
  const currency = session.org?.defaultCurrency ?? 'EGP';
  const low = item.reorderLevel !== null && available <= item.reorderLevel;

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'stock', label: tr('Stock by warehouse'), show: true },
    { key: 'moves', label: tr('Movements'), show: true },
    { key: 'batches', label: tr('Batches'), show: !demoMode && can('inventory.batches.read') },
    { key: 'units', label: tr('Units'), show: !demoMode },
    { key: 'cost', label: tr('Cost'), show: !demoMode && isManager },
    { key: 'history', label: tr('History'), show: !demoMode },
  ];

  return (
    <section className="page">
      <Link to="/inventory" className="back-link">{tr('← Stock on hand')}</Link>
      <div className="page-head">
        <h1>
          <code>{item.sku}</code> {item.name}
          {item.nameAr ? <span className="muted" dir="rtl"> · {item.nameAr}</span> : null}
        </h1>
        <div className="form-actions">
          {can('inventory.items.manage') && !demoMode && <Button variant="outline" onClick={() => setEditing(true)}>{tr('Edit')}</Button>}
          <Button variant="outline" onClick={() => navigate('/inventory/requests/new')}>{tr('Request stock')}</Button>
          {can('inventory.adjustments.create') && !demoMode && <Button variant="outline" onClick={() => navigate('/inventory/counts')}>{tr('Count')}</Button>}
        </div>
      </div>

      <div className="stats">
        <div className="stat" style={{ '--i': 0 } as CSSProperties}><div className="stat-label">{tr('On hand')}</div><div className="stat-value">{qty(onHand)}</div><div className="stat-note">{item.uom}</div></div>
        <div className="stat" style={{ '--i': 1 } as CSSProperties}><div className="stat-label">{tr('Reserved')}</div><div className="stat-value">{qty(reserved)}</div><div className="stat-note">{tr('for approved requests')}</div></div>
        <div className={low ? 'stat warn' : 'stat'} style={{ '--i': 2 } as CSSProperties}>
          <div className="stat-label">{tr('Available')}</div><div className="stat-value">{qty(available)}</div>
          <div className="stat-note">{item.reorderLevel === null ? tr('No reorder level set') : trf('Reorder at {n}', { n: qty(item.reorderLevel) })}</div>
        </div>
        {fc && (
          <div className="stat" style={{ '--i': 3 } as CSSProperties}>
            <div className="stat-label">{tr('Runs out')}</div>
            <div className="stat-value">{fc.runsOutOn ? formatDay(fc.runsOutOn, session.org) : '—'}</div>
            <div className="stat-note">{fc.runsOutOn ? trf('about {n} days of stock', { n: fc.daysOfCover ?? 0 }) : tr('not used lately')}</div>
          </div>
        )}
        {cost && cost.avgCostMinor !== null && (
          <div className="stat" style={{ '--i': 4 } as CSSProperties}>
            <div className="stat-label">{tr('Average cost')}</div>
            <div className="stat-value">{formatMoney({ amountMinor: cost.avgCostMinor, currency })}</div>
            <div className="stat-note">{trf('{unit} each', { unit: item.uom })}</div>
          </div>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label={tr('Item details')}>
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'stock' && (
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{tr('Warehouse')}</th><th scope="col" className="right">{tr('On hand')}</th><th scope="col" className="right">{tr('Reserved')}</th><th scope="col" className="right">{tr('Available')}</th></tr></thead>
            <tbody>
              {rows.map((s) => <tr key={s.warehouseId}><td>{cat.warehouseName(s.warehouseId)}</td><td className="right">{qty(s.onHand)}</td><td className="right">{qty(s.reserved)}</td><td className="right"><strong>{qty(s.available)}</strong></td></tr>)}
              {rows.length === 0 && <tr><td colSpan={4} className="muted">{tr('No stock of this item in any warehouse.')}</td></tr>}
            </tbody>
          </table></div>
        )}

        {tab === 'moves' && (moves.data ? (
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{tr('When')}</th><th scope="col">{tr('Warehouse')}</th><th scope="col">{tr('Type')}</th><th scope="col" className="right">{tr('Quantity')}</th><th scope="col">{tr('Reference')}</th><th scope="col">{tr('Posted by')}</th></tr></thead>
            <tbody>
              {itemMoves.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{formatDateTime(m.postedAt, session.org)}</td>
                  <td>{cat.warehouseName(m.warehouseId)}</td>
                  <td>{tr(MOVE_KIND_LABEL[m.kind] ?? m.kind)}</td>
                  <td className="right"><strong className={m.qty < 0 ? 'overdue' : undefined}>{m.qty > 0 ? `+${qty(m.qty)}` : qty(m.qty)}</strong></td>
                  <td>{m.requestId ? <Link to={`/inventory/requests/${m.requestId}`}>{m.requestNumber ?? tr('Request')}</Link> : m.ref ? <code>{m.ref}</code> : <span className="muted">—</span>}</td>
                  <td>{who(m.postedBy)}</td>
                </tr>
              ))}
              {itemMoves.length === 0 && <tr><td colSpan={6} className="muted">{tr('No movements yet.')}</td></tr>}
            </tbody>
          </table></div>
        ) : <Loading />)}

        {tab === 'batches' && (
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{tr('Batch')}</th><th scope="col">{tr('Expires')}</th><th scope="col">{tr('Status')}</th><th scope="col" className="right">{tr('Quantity')}</th></tr></thead>
            <tbody>
              {itemBatches.map((b) => (
                <tr key={b.id}><td><code>{b.batchNo}</code></td><td>{b.expiryDate ? formatDay(b.expiryDate, session.org) : tr('No expiry')}</td><td>{tr(b.status)}</td>
                  <td className="right">{qty((b.stock ?? []).reduce((a, x) => a + x.qty, 0))}</td></tr>
              ))}
              {itemBatches.length === 0 && <tr><td colSpan={4} className="muted">{tr('This item has no batches.')}</td></tr>}
            </tbody>
          </table></div>
        )}

        {tab === 'units' && (
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{tr('Unit')}</th><th scope="col" className="right">{trf('In {unit}', { unit: item.uom })}</th><th scope="col">{tr('Used for')}</th></tr></thead>
            <tbody>
              <tr><td><strong>{item.uom}</strong></td><td className="right">1</td><td className="muted">{tr('Base unit: stock is counted in it')}</td></tr>
              {(units.data ?? []).map((u) => (
                <tr key={u.id}><td>{u.unit}</td><td className="right">{qty(u.factor)}</td>
                  <td>{[u.forPurchase ? tr('Buying') : '', u.forSale ? tr('Selling') : ''].filter(Boolean).join(', ') || <span className="muted">—</span>}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}

        {tab === 'cost' && (
          cost ? (
            <dl className="facts">
              <div><dt>{tr('Average cost')}</dt><dd>{cost.avgCostMinor === null ? tr('Not set') : formatMoney({ amountMinor: cost.avgCostMinor, currency })}</dd></div>
              <div><dt>{tr('On hand')}</dt><dd>{qty(cost.onHand)} {item.uom}</dd></div>
              <div><dt>{tr('Stock value')}</dt><dd>{cost.valueMinor === null ? '—' : formatMoney({ amountMinor: cost.valueMinor, currency })}</dd></div>
            </dl>
          ) : costs.data ? <p className="muted">{tr('No cost recorded for this item yet.')}</p> : <Loading />
        )}

        {tab === 'history' && <RecordHistory id={item.id} />}
      </div>

      {editing && <EditItemModal item={item} onClose={() => setEditing(false)} onDone={() => { setEditing(false); cat.items.reload(); }} />}
    </section>
  );
}

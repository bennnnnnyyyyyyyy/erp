import { useState, type CSSProperties } from 'react';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { hasPermission } from '@erp/shared';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import type { DemoItem, DemoRequest, StockRow } from '../../lib/demoInventory';
import { Link } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';
import { ClerkActions } from './ClerkActions';
import { tr, trf } from '../../lib/i18n';
import { qty, useCatalog } from './inventoryShared';
import { AddItemModal, AddWarehouseModal, EditItemModal } from './ItemModals';

// ------------------------------------------------------------------ stock on hand and items

/** One row of Stock on hand: an item in one warehouse (inventory redesign Q4 B), or the item alone when it has no stock anywhere.
 *  `totalAvailable` is the item's available stock in all warehouses: the status compares it with the item's reorder level. */
type StockLine = DemoItem & { warehouseId: string | null; onHand: number; reserved: number; available: number; totalAvailable: number };

export function StockPage() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const requests = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests'));
  const [warehouseId, setWarehouseId] = useState('all');
  const [adding, setAdding] = useState(false);
  const [addingWarehouse, setAddingWarehouse] = useState(false);
  const [editing, setEditing] = useState<DemoItem | null>(null);
  const session = useSession();
  const canAdd = hasPermission(session.permissions, 'inventory.items.manage');
  const canEdit = canAdd && !demoMode;
  const canAddWarehouse = hasPermission(session.permissions, 'inventory.warehouses.manage');

  // One row per item and warehouse (Ben, 10 Nov: Q4 B). An item with no stock anywhere still gets one row, so new items show.
  const items = cat.items.data ?? [];
  const totalAvailable = (itemId: string) => (stock.data ?? []).filter((s) => s.itemId === itemId).reduce((a, s) => a + s.available, 0);
  const rows: StockLine[] = items.flatMap((i): StockLine[] => {
    const all = (stock.data ?? []).filter((s) => s.itemId === i.id);
    const total = all.reduce((a, s) => a + s.available, 0);
    const mine = all.filter((s) => warehouseId === 'all' || s.warehouseId === warehouseId);
    if (mine.length === 0) return warehouseId === 'all' ? [{ ...i, warehouseId: null, onHand: 0, reserved: 0, available: 0, totalAvailable: total }] : [];
    return mine.map((s) => ({ ...i, warehouseId: s.warehouseId, onHand: s.onHand, reserved: s.reserved, available: s.available, totalAvailable: total }));
  });
  const isLow = (i: DemoItem, available: number) => i.reorderLevel !== null && available <= i.reorderLevel;

  const columns: Column<StockLine>[] = [
    { key: 'sku', label: 'SKU', value: (r) => r.sku, render: (r) => <code>{r.sku}</code> },
    { key: 'name', label: tr('Item'), value: (r) => r.name, render: (r) => <strong>{r.name}</strong> },
    { key: 'wh', label: tr('Warehouse'), value: (r) => (r.warehouseId ? cat.warehouseName(r.warehouseId) : ''), render: (r) => (r.warehouseId ? cat.warehouseName(r.warehouseId) : <span className="muted">{tr('No stock yet')}</span>) },
    { key: 'ar', label: tr('Arabic name'), value: (r) => r.nameAr, render: (r) => <span dir="rtl">{r.nameAr}</span> },
    { key: 'uom', label: tr('Unit'), value: (r) => r.uom },
    // Status of the item (all warehouses) against its reorder level, which is set per item. "Out" when nothing is available anywhere.
    { key: 'level', label: tr('Status'), value: (r) => (r.totalAvailable <= 0 ? 'out' : r.reorderLevel === null ? '' : isLow(r, r.totalAvailable) ? 'low' : 'ok'), render: (r) =>
      r.totalAvailable <= 0
        ? <Pill status="rejected" label={tr('Out')} />
        : r.reorderLevel === null
          ? <span className="muted" title={tr('No reorder level set')}>—</span>
          : isLow(r, r.totalAvailable)
            ? <Pill status="submitted" label={tr('Low')} />
            : <Pill status="received" label={tr('OK')} /> },
    { key: 'onHand', label: tr('On hand'), value: (r) => r.onHand, align: 'right', render: (r) => qty(r.onHand) },
    { key: 'reserved', label: tr('Reserved'), value: (r) => r.reserved, align: 'right', render: (r) => (r.reserved ? qty(r.reserved) : <span className="muted">0</span>) },
    { key: 'available', label: tr('Available'), value: (r) => r.available, align: 'right', render: (r) => <strong>{qty(r.available)}</strong> },
    ...(canEdit
      ? [{
          key: 'edit',
          label: tr('Actions'),
          value: () => '',
          render: (r: StockLine) => (
            <Button variant="outline" size="sm" onClick={() => setEditing(r)} aria-label={trf('Edit {name}', { name: r.name })}>{tr('Edit')}</Button>
          ),
        }]
      : []),
  ];

  // Totals of units are left out on purpose: they add kilograms, litres and pieces together (287,963.501 "units").
  // The numbers count items, not rows (an item in two warehouses is one item).
  const lowCount = items.filter((i) => isLow(i, totalAvailable(i.id))).length;
  const reservedItems = items.filter((i) => (stock.data ?? []).some((s) => s.itemId === i.id && s.reserved > 0)).length;
  const waiting = (requests.data ?? []).filter((r) => r.status === 'submitted').length;

  return (
    <section className="page">
      <h1>{tr('Stock on hand')}</h1>
      <p className="muted">{tr('On-hand, reserved and available quantities by warehouse.')}</p>
      {cat.ready && stock.data && (
        <div className="stats">
          <div className="stat" style={{ '--i': 0 } as CSSProperties}>
            <div className="stat-label">{tr('Items')}</div>
            <div className="stat-value">{items.length}</div>
            <div className="stat-note">{warehouseId === 'all' ? trf('in {n} warehouses', { n: cat.warehouses.data?.length ?? 0 }) : cat.warehouseName(warehouseId)}</div>
          </div>
          <Link to="/inventory/reorder-levels" className={lowCount > 0 ? 'stat warn' : 'stat'} style={{ '--i': 1, textDecoration: 'none', color: 'inherit' } as CSSProperties}>
            <div className="stat-label">{tr('Low on stock')}</div>
            <div className="stat-value">{lowCount}</div>
            <div className="stat-note">{lowCount > 0 ? tr('at or below their reorder level') : tr('nothing below its reorder level')}</div>
          </Link>
          <div className="stat" style={{ '--i': 2 } as CSSProperties}>
            <div className="stat-label">{tr('Reserved')}</div>
            <div className="stat-value">{reservedItems}</div>
            <div className="stat-note">{tr('items with reserved stock')}</div>
          </div>
          <Link to="/inventory/requests" className={waiting > 0 ? 'stat warn' : 'stat'} style={{ '--i': 3, textDecoration: 'none', color: 'inherit' } as CSSProperties}>
            <div className="stat-label">{tr('Waiting for approval')}</div>
            <div className="stat-value">{waiting}</div>
            <div className="stat-note">{waiting > 0 ? tr('awaiting manager approval') : tr('nothing pending')}</div>
          </Link>
        </div>
      )}
      {cat.ready && stock.data ? (
        <ListView
          title={tr('Stock on hand')}
          rows={rows}
          columns={columns}
          rowKey={(r) => `${r.id}:${r.warehouseId ?? "-"}`}
          rowHref={(r) => `/inventory/items/${r.id}`}
          toolbar={
            <>
              <select className="narrow-select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label={tr('Warehouse')}>
                <option value="all">{tr('All warehouses')}</option>
                {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              {canAddWarehouse && <Button variant="outline" type="submit" onClick={() => setAddingWarehouse(true)}>{tr('Add warehouse')}</Button>}
              {canAdd && (cat.warehouses.data?.length ?? 0) > 0 && <Button type="submit" onClick={() => setAdding(true)}>{tr('Add item')}</Button>}
            </>
          }
        />
      ) : (
        <Loading />
      )}
      {cat.ready && (cat.warehouses.data?.length ?? 0) === 0 && (
        <p className="notice">{canAddWarehouse ? tr('Start by adding your first warehouse (any place you keep stock), then add items to it.') : tr('No warehouse exists yet. Ask an owner or admin to add one.')}</p>
      )}
      {addingWarehouse && <AddWarehouseModal onClose={() => setAddingWarehouse(false)} onDone={() => { setAddingWarehouse(false); cat.warehouses.reload(); stock.reload(); }} />}
      {editing && <EditItemModal item={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); cat.items.reload(); }} />}
      {adding && cat.warehouses.data && (
        <AddItemModal warehouses={cat.warehouses.data} onClose={() => setAdding(false)} onDone={() => { setAdding(false); cat.items.reload(); stock.reload(); }} />
      )}
      <ClerkActions />
    </section>
  );
}


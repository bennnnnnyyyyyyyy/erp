import type { CSSProperties, ReactNode } from 'react';
import { hasPermission } from '@erp/shared';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import type { DemoRequest, DemoTransfer, StockRow } from '../../lib/demoInventory';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { Link, navigate } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { ClerkActions } from './ClerkActions';
import { useCatalog } from './Inventory';

// Inventory overview (inventory redesign Q2 "What needs you today", Ben 10 Nov 2026). What opens when someone clicks Inventory: four
// numbers, then the things this person can act on now, each with its button, then shortcuts. Read-only; it uses the same lists as the
// other screens, and shows each person only what their role lets them do.

type Expiring = { batchId: string; itemId: string; batchNo: string; qty: number; expiryDate: string; daysLeft: number };
type Count = { id: string; number: string; warehouseId: string; status: string; requesterId: string; submittedBy: string | null };
type Task = { key: string; rank: number; text: ReactNode; to: string; action: string };

const DAY = 86_400_000;
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
const optional = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);

export function InventoryOverview() {
  const session = useSession();
  const cat = useCatalog();
  const can = (key: string) => hasPermission(session.permissions, key);
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const requests = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests'));
  const transfers = useLoad(() => (can('inventory.transfers.read') ? optional(api<DemoTransfer[]>('/v1/inventory/transfers')) : Promise.resolve([] as DemoTransfer[])));
  const expiring = useLoad(() =>
    demoMode || !can('inventory.batches.read') ? Promise.resolve([] as Expiring[]) : optional(api<Expiring[]>('/v1/inventory/expiry?days=30')),
  );
  const counts = useLoad(() =>
    demoMode || !can('inventory.adjustments.read') ? Promise.resolve([] as Count[]) : optional(api<Count[]>('/v1/inventory/counts')),
  );

  if (!cat.ready || !stock.data || !requests.data || !transfers.data || !expiring.data || !counts.data) {
    return <section className="page"><Loading error={stock.error ?? requests.error} /></section>;
  }

  // ---- the four numbers
  const items = cat.items.data ?? [];
  const available = (itemId: string) => stock.data!.filter((s) => s.itemId === itemId).reduce((a, s) => a + s.available, 0);
  const low = items.filter((i) => i.reorderLevel !== null && available(i.id) <= i.reorderLevel);
  const waitingRequests = requests.data.filter((r) => r.status === 'submitted');
  const waitingTransfers = transfers.data.filter((t) => t.status === 'submitted');
  const waitingCounts = counts.data.filter((c) => c.status === 'submitted');
  const waiting = waitingRequests.length + waitingTransfers.length + waitingCounts.length;
  const inTransit = transfers.data.filter((t) => t.status === 'dispatched');

  // ---- what needs this person, most urgent first
  const tasks: Task[] = [];
  if (can('inventory.request.approve'))
    for (const r of waitingRequests)
      tasks.push({ key: `rq${r.id}`, rank: 0, to: `/inventory/requests/${r.id}`, action: tr('Open'),
        text: trf('{number}: {n} item(s) from {warehouse}, waiting for approval', { number: r.number, n: r.lines.length, warehouse: cat.warehouseName(r.warehouseId) }) });
  if (can('inventory.transfers.approve'))
    for (const t of waitingTransfers)
      tasks.push({ key: `tr${t.id}`, rank: 0, to: `/inventory/transfers/${t.id}`, action: tr('Open'),
        text: trf('{number}: {from} → {to}, waiting for approval', { number: t.number, from: cat.warehouseName(t.fromWarehouseId), to: cat.warehouseName(t.toWarehouseId) }) });
  if (can('inventory.adjustments.approve'))
    for (const c of waitingCounts)
      tasks.push({ key: `ct${c.id}`, rank: 0, to: `/inventory/counts/${c.id}`, action: tr('Open'),
        text: trf('Stock count {number} in {warehouse}, waiting for approval', { number: c.number, warehouse: cat.warehouseName(c.warehouseId) }) });
  if (can('inventory.stock.issue'))
    for (const r of requests.data.filter((x) => x.status === 'approved'))
      tasks.push({ key: `is${r.id}`, rank: 1, to: `/inventory/requests/${r.id}`, action: tr('Issue'),
        text: trf('{number} is approved: issue the stock from {warehouse}', { number: r.number, warehouse: cat.warehouseName(r.warehouseId) }) });
  if (can('inventory.transfers.receive'))
    for (const t of inTransit) {
      const days = t.dispatchedAt ? Math.floor((Date.now() - Date.parse(t.dispatchedAt)) / DAY) : 0;
      tasks.push({ key: `rc${t.id}`, rank: 2, to: `/inventory/transfers/${t.id}`, action: tr('Receive'),
        text: days >= 1
          ? trf('{number} has been in transit to {to} for {n} day(s)', { number: t.number, to: cat.warehouseName(t.toWarehouseId), n: days })
          : trf('{number} is on its way to {to}', { number: t.number, to: cat.warehouseName(t.toWarehouseId) }) });
    }
  for (const i of low)
    tasks.push({ key: `lo${i.id}`, rank: 3, to: `/inventory/items/${i.id}`, action: tr('Open'),
      text: trf('{item} is low: {left} left, reorder at {level}', { item: i.name, left: qty(available(i.id)), level: qty(i.reorderLevel ?? 0) }) });
  for (const b of expiring.data)
    tasks.push({ key: `ex${b.batchId}${b.expiryDate}`, rank: 4, to: `/inventory/items/${b.itemId}`, action: tr('Open'),
      text: b.daysLeft < 0
        ? trf('Batch {batch} of {item} expired on {date} ({qty} left)', { batch: b.batchNo, item: cat.itemName(b.itemId), date: formatDay(b.expiryDate, session.org), qty: qty(b.qty) })
        : trf('Batch {batch} of {item} expires on {date} ({qty} left)', { batch: b.batchNo, item: cat.itemName(b.itemId), date: formatDay(b.expiryDate, session.org), qty: qty(b.qty) }) });
  tasks.sort((a, b) => a.rank - b.rank);
  const shown = tasks.slice(0, 12);

  const stat = (i: number, label: string, value: number, note: string, to: string | null, warn: boolean) => {
    const body = (<><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></>);
    const style = { '--i': i, textDecoration: 'none', color: 'inherit' } as CSSProperties;
    return to ? <Link key={label} to={to} className={warn ? 'stat warn' : 'stat'} style={style}>{body}</Link> : <div key={label} className="stat" style={style}>{body}</div>;
  };

  return (
    <section className="page">
      <h1>{tr('Inventory')}</h1>
      <div className="stats">
        {stat(0, tr('Low on stock'), low.length, low.length ? tr('at or below their reorder level') : tr('nothing below its reorder level'), '/inventory/reorder-levels', low.length > 0)}
        {stat(1, tr('Waiting for approval'), waiting, waiting ? tr('requests, transfers and counts') : tr('nothing pending'), '/inventory/requests', waiting > 0)}
        {!demoMode && can('inventory.batches.read') && stat(2, tr('Expiring in 30 days'), expiring.data.length, tr('batches'), '/inventory/batches', expiring.data.length > 0)}
        {can('inventory.transfers.read') && stat(3, tr('In transit'), inTransit.length, tr('transfers on the way'), '/inventory/transfers', false)}
      </div>

      <h2 className="related">{tr('Needs you today')}</h2>
      {shown.length === 0 ? (
        <p className="notice">{tr('Nothing needs you right now.')}</p>
      ) : (
        <ul className="task-list">
          {shown.map((t) => (
            <li key={t.key}>
              <span>{t.text}</span>
              <Button variant="outline" size="sm" onClick={() => navigate(t.to)}>{t.action}</Button>
            </li>
          ))}
        </ul>
      )}
      {tasks.length > shown.length && <p className="muted small">{trf('and {n} more', { n: tasks.length - shown.length })}</p>}

      <div className="form-actions" style={{ marginBlockStart: '1.5rem' }}>
        <Button onClick={() => navigate('/inventory/stock')}>{tr('Stock on hand')}</Button>
        {can('inventory.request.create') && <Button variant="outline" onClick={() => navigate('/inventory/requests/new')}>{tr('New request')}</Button>}
        {can('inventory.transfers.create') && <Button variant="outline" onClick={() => navigate('/inventory/transfers/new')}>{tr('New transfer')}</Button>}
        {!demoMode && can('inventory.adjustments.create') && <Button variant="outline" onClick={() => navigate('/inventory/counts')}>{tr('Start a count')}</Button>}
      </div>
      <ClerkActions />
    </section>
  );
}

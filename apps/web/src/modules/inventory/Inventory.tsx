import { useState, type CSSProperties, type FormEvent } from 'react';
import { RecordHistory } from '../../components/RecordHistory';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { hasPermission, type AuditEntry } from '@erp/shared';
import { Modal } from '../../components/Modal';
import { ListView, type Column } from '../../components/views/ListView';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import type { ApprovalPolicy, DemoItem, DemoRequest, DemoWarehouse, LedgerMove, RequestStatus, StockAdjustment, StockRow } from '../../lib/demoInventory';
import { usePeople } from '../../lib/people';
import { formatDateTime, ltrIsolate, qtyLine } from '../../lib/format';
import { Link, navigate, useParam } from '../../lib/router';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { parseAmount } from '../../lib/numbers';
import { Pill } from '../trade/common';
import { ConfirmButton, FormToggle } from '../../components/FormToggle';

import { tr, trf } from '../../lib/i18n';
// Inventory slice 1 screens. They call /v1/inventory/... : the real API in the real app, and the in-browser sample
// (lib/demoInventory.ts) in demo mode. Plan: documentation/plans/INVENTORY_PLAN.md.

/** A quantity for display: thousands separated, at most three decimals, no trailing zeros (4,826 or 12.5). */
const qty = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });

const STATUS_LABEL: Record<RequestStatus, string> = {
  submitted: 'Waiting for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  issued: 'Issued',
  cancelled: 'Cancelled',
};

function StatusPill({ status }: { status: RequestStatus }) {
  return <span className={`pill st-${status}`}>{tr(STATUS_LABEL[status])}</span>;
}

// Submitted, approved, issued: where this request is on the way out of the warehouse.
function Steps({ status }: { status: RequestStatus }) {
  const order: RequestStatus[] = ['submitted', 'approved', 'issued'];
  const ended = status === 'rejected' || status === 'cancelled';
  const at = order.indexOf(status);
  const label = ['Submitted', ended ? (status === 'rejected' ? 'Rejected' : 'Cancelled') : 'Approved', 'Issued'];
  return (
    <ol className="steps" aria-label={tr('Request progress')}>
      {label.map((text, i) => {
        const cls = ended ? (i === 0 ? 'done' : i === 1 ? 'bad' : '') : i < at ? 'done' : i === at ? (status === 'issued' ? 'done' : 'current') : '';
        return (
          <li key={text} className={`step ${cls}`} data-n={i + 1}>
            {tr(text)}
          </li>
        );
      })}
    </ol>
  );
}

export function useCatalog() {
  const items = useLoad(() => api<DemoItem[]>('/v1/inventory/items'));
  const warehouses = useLoad(() => api<DemoWarehouse[]>('/v1/inventory/warehouses'));
  const itemName = (id: string) => items.data?.find((i) => i.id === id)?.name ?? id;
  const warehouseName = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;
  return { items, warehouses, itemName, warehouseName, ready: Boolean(items.data && warehouses.data) };
}


// ------------------------------------------------------------------ stock on hand and items

type StockLine = DemoItem & { onHand: number; reserved: number; available: number };

function AddItemModal({ warehouses, onClose, onDone }: { warehouses: DemoWarehouse[]; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ sku: '', name: '', nameAr: '', uom: 'piece', openingQty: '0', warehouseId: warehouses[0]?.id ?? '', cost: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/v1/inventory/items', { method: 'POST', body: JSON.stringify({ sku: form.sku, name: form.name, nameAr: form.nameAr, uom: form.uom, warehouseId: form.warehouseId, openingQty: Number(form.openingQty), unitCostMinor: form.cost.trim() ? Math.round(Number(form.cost) * 100) : null }) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={tr('Add item')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="form-row">
          <label>SKU<input required value={form.sku} onChange={set('sku')} /></label>
          <label>{tr('Unit')}<input required value={form.uom} onChange={set('uom')} /></label>
        </div>
        <label>{tr('Name')}<input required value={form.name} onChange={set('name')} /></label>
        <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={form.nameAr} onChange={set('nameAr')} /></label>
        <div className="form-row">
          <label>{tr('Opening stock (optional)')}<input type="number" min="0" value={form.openingQty} onChange={set('openingQty')} /></label>
          {/* sql/046: opening stock is a receipt, so it carries a unit cost (required once accounting is on). */}
          <label>{tr('Unit cost (needed with accounting)')}<input inputMode="decimal" placeholder="0.00" value={form.cost} onChange={set('cost')} /></label>
          <label>
            {tr('Warehouse')}
            <select value={form.warehouseId} onChange={set('warehouseId')}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><Button type="submit">{tr('Add item')}</Button></div>
      </form>
    </Modal>
  );
}

function AddWarehouseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', nameAr: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/v1/inventory/warehouses', { method: 'POST', body: JSON.stringify(form) });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal title={tr('Add warehouse')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">{tr('A warehouse is any place you keep stock: a store room, a cold room, a shelf area. Items are received into one.')}</p>
        <div className="form-row">
          <label>{tr('Short code')}<input required maxLength={32} placeholder="MAIN" value={form.code} onChange={set('code')} /></label>
          <label>{tr('Name')}<input required placeholder={tr('Main warehouse')} value={form.name} onChange={set('name')} /></label>
        </div>
        <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={form.nameAr} onChange={set('nameAr')} /></label>
        {error && <p className="error">{error}</p>}
        <div className="form-actions"><Button type="submit">{tr('Add warehouse')}</Button></div>
      </form>
    </Modal>
  );
}

export function StockPage() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const requests = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests'));
  const [warehouseId, setWarehouseId] = useState('all');
  const [adding, setAdding] = useState(false);
  const [addingWarehouse, setAddingWarehouse] = useState(false);
  const session = useSession();
  const canAdd = hasPermission(session.permissions, 'inventory.items.manage');
  const canAddWarehouse = hasPermission(session.permissions, 'inventory.warehouses.manage');

  const rows: StockLine[] = (cat.items.data ?? []).map((i) => {
    const mine = (stock.data ?? []).filter((s) => s.itemId === i.id && (warehouseId === 'all' || s.warehouseId === warehouseId));
    const sum = (f: (s: StockRow) => number) => mine.reduce((a, s) => a + f(s), 0);
    return { ...i, onHand: sum((s) => s.onHand), reserved: sum((s) => s.reserved), available: sum((s) => s.available) };
  });

  const columns: Column<StockLine>[] = [
    { key: 'sku', label: 'SKU', value: (r) => r.sku, render: (r) => <code>{r.sku}</code> },
    { key: 'name', label: tr('Item'), value: (r) => r.name, render: (r) => <strong>{r.name}</strong> },
    { key: 'ar', label: tr('Arabic name'), value: (r) => r.nameAr, render: (r) => <span dir="rtl">{r.nameAr}</span> },
    { key: 'uom', label: tr('Unit'), value: (r) => r.uom },
    // Status against the item's reorder level. The old bar showed available ÷ on hand, which is almost always 100%: every row had the
    // same full bar and it said nothing.
    { key: 'level', label: tr('Status'), value: (r) => (r.reorderLevel === null ? '' : r.available <= r.reorderLevel ? 'low' : 'ok'), render: (r) =>
      r.reorderLevel === null
        ? <span className="muted" title={tr('No reorder level set')}>—</span>
        : r.available <= r.reorderLevel
          ? <Pill status="rejected" label={tr('Low')} />
          : <Pill status="received" label={tr('OK')} /> },
    { key: 'onHand', label: tr('On hand'), value: (r) => r.onHand, align: 'right', render: (r) => qty(r.onHand) },
    { key: 'reserved', label: tr('Reserved'), value: (r) => r.reserved, align: 'right', render: (r) => (r.reserved ? qty(r.reserved) : <span className="muted">0</span>) },
    { key: 'available', label: tr('Available'), value: (r) => r.available, align: 'right', render: (r) => <strong>{qty(r.available)}</strong> },
  ];

  // Totals of units are left out on purpose: they add kilograms, litres and pieces together (287,963.501 "units").
  const lowCount = rows.filter((r) => r.reorderLevel !== null && r.available <= r.reorderLevel).length;
  const reservedItems = rows.filter((r) => r.reserved > 0).length;
  const waiting = (requests.data ?? []).filter((r) => r.status === 'submitted').length;

  return (
    <section className="page">
      <h1>{tr('Stock on hand')}</h1>
      <p className="muted">{tr('On-hand, reserved and available quantities by warehouse.')}</p>
      {cat.ready && stock.data && (
        <div className="stats">
          <div className="stat" style={{ '--i': 0 } as CSSProperties}>
            <div className="stat-label">{tr('Items')}</div>
            <div className="stat-value">{rows.length}</div>
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
          rowKey={(r) => r.id}
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
      {adding && cat.warehouses.data && (
        <AddItemModal warehouses={cat.warehouses.data} onClose={() => setAdding(false)} onDone={() => { setAdding(false); cat.items.reload(); stock.reload(); }} />
      )}
    </section>
  );
}

// ------------------------------------------------------------------ reorder levels

type ReorderLine = DemoItem & { available: number; onHand: number; reserved: number; low: boolean };

export function ReorderLevelsPage() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const session = useSession();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = session.role === 'owner' || session.role === 'admin';

  const rows: ReorderLine[] = (cat.items.data ?? []).map((item) => {
    const balances = (stock.data ?? []).filter((s) => s.itemId === item.id);
    const onHand = balances.reduce((sum, s) => sum + s.onHand, 0);
    const reserved = balances.reduce((sum, s) => sum + s.reserved, 0);
    const available = onHand - reserved;
    return { ...item, onHand, reserved, available, low: item.reorderLevel !== null && available <= item.reorderLevel };
  });

  async function save(row: ReorderLine) {
    const raw = drafts[row.id] ?? (row.reorderLevel === null ? '' : String(row.reorderLevel));
    const level = raw.trim() === '' ? null : Number(raw);
    if (level !== null && (!Number.isFinite(level) || level < 0)) {
      setError('Reorder level must be zero or more, or empty.');
      return;
    }
    setSaving(row.id);
    setNotice(null);
    setError(null);
    try {
      await api(`/v1/inventory/items/${row.id}/reorder-level`, { method: 'POST', body: JSON.stringify({ level }) });
      setDrafts((current) => { const next = { ...current }; delete next[row.id]; return next; });
      cat.items.reload();
      setNotice(trf('{sku} reorder level saved.', { sku: row.sku }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  }

  if (!cat.ready || !stock.data) return <section className="page"><Loading /></section>;

  return (
    <section className="page">
      <h1>{tr('Reorder levels')}</h1>
      <p className="muted">{tr('Minimum available quantity per item before reordering.')}</p>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error notice">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">SKU</th><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Available')}</th><th scope="col" className="right">{tr('Reorder level')}</th><th scope="col">{tr('Status')}</th><th scope="col"><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const value = drafts[row.id] ?? (row.reorderLevel === null ? '' : String(row.reorderLevel));
              return (
                <tr key={row.id}>
                  <td><code>{row.sku}</code></td>
                  <td><strong>{row.name}</strong><div className="muted small">{row.uom} · {row.reserved} reserved</div></td>
                  <td className="right"><strong>{row.available}</strong></td>
                  <td className="right">
                    {canManage ? <input className="narrow-input" type="number" min="0" step="0.001" aria-label={trf('Reorder level for {sku}', { sku: row.sku })} value={value} onChange={(e) => setDrafts((current) => ({ ...current, [row.id]: e.target.value }))} placeholder={tr('Off')} /> : (row.reorderLevel ?? tr('Off'))}
                  </td>
                  <td>{row.reorderLevel === null ? <span className="muted">{tr('Not monitored')}</span> : row.low ? <span className="pill st-rejected">{tr('Low stock')}</span> : <span className="pill st-approved">{tr('Healthy')}</span>}</td>
                  <td>{canManage && <Button type="submit" disabled={saving === row.id} onClick={() => save(row)}>{saving === row.id ? tr('Saving…') : tr('Save')}</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canManage && <p className="hint muted small">{tr('Only owners and admins can change reorder levels.')}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ approval policies

export function ApprovalPoliciesPage() {
  const cat = useCatalog();
  const policies = useLoad(() => api<ApprovalPolicy[]>('/v1/inventory/approval-policies'));
  const session = useSession();
  const [form, setForm] = useState({ warehouseId: '', minTotalQty: '', requiredApprovals: '2' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = session.role === 'owner' || session.role === 'admin';

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/v1/inventory/approval-policies', { method: 'POST', body: JSON.stringify({ warehouseId: form.warehouseId || null, minTotalQty: Number(form.minTotalQty), requiredApprovals: Number(form.requiredApprovals) }) });
      setForm({ warehouseId: '', minTotalQty: '', requiredApprovals: '2' });
      policies.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/v1/inventory/approval-policies/${id}`, { method: 'DELETE' });
      policies.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const warehouseName = (id: string | null) => id ? cat.warehouseName(id) : tr('All warehouses');

  if (!cat.warehouses.data || !policies.data) return <section className="page"><Loading /></section>;

  return (
    <section className="page">
      <h1>{tr('Approval policies')}</h1>
      <p className="muted">{tr('Thresholds above which a stock request needs more than one approval.')}</p>
      {error && <p className="error notice">{error}</p>}
      {canManage && (
        <FormToggle label={tr('Add or update a policy')}><form className="stack" onSubmit={save}>
          <div className="form-row">
            <label>{tr('From total quantity')}<input required type="number" min="0" step="0.001" value={form.minTotalQty} onChange={(e) => setForm((f) => ({ ...f, minTotalQty: e.target.value }))} /></label>
            <label>{tr('Required approvals')}<select value={form.requiredApprovals} onChange={(e) => setForm((f) => ({ ...f, requiredApprovals: e.target.value }))}><option value="1">{tr('1 approval')}</option><option value="2">{tr('2 approvals')}</option><option value="3">{tr('3 approvals')}</option></select></label>
            <label>{tr('Warehouse')}<select value={form.warehouseId} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}><option value="">{tr('All warehouses')}</option>{cat.warehouses.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          </div>
          <div className="form-actions"><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save policy')}</Button></div>
        </form></FormToggle>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('Threshold')}</th><th scope="col">{tr('Warehouse')}</th><th scope="col">{tr('Required')}</th>{canManage && <th scope="col"><span className="sr-only">{tr('Actions')}</span></th>}</tr></thead>
          <tbody>
            {policies.data.map((p) => <tr key={p.id}><td><strong>{p.minTotalQty}</strong> {tr('units or more')}</td><td>{warehouseName(p.warehouseId)}</td><td>{trf(p.requiredApprovals === 1 ? '{n} approval' : '{n} approvals', { n: p.requiredApprovals })}</td>{canManage && <td><Button variant="outline" type="submit" onClick={() => remove(p.id)}>{tr('Remove')}</Button></td>}</tr>)}
            {policies.data.length === 0 && <tr><td colSpan={canManage ? 4 : 3} className="muted empty">{tr('No extra approval policies. One approval is enough for every request.')}</td></tr>}
          </tbody>
        </table>
      </div>
      {!canManage && <p className="hint muted small">{tr('Only owners and admins can change approval policies.')}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ stock adjustments / cycle counts

const ADJUSTMENT_STATUS: Record<StockAdjustment['status'], string> = { submitted: 'Waiting for approval', applied: 'Applied', rejected: 'Rejected', cancelled: 'Cancelled' };

export function AdjustmentsPage() {
  const cat = useCatalog();
  const adjustments = useLoad(() => api<StockAdjustment[]>('/v1/inventory/adjustments'));
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const session = useSession();
  const [form, setForm] = useState({ itemId: '', warehouseId: '', countedQty: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canApprove = hasPermission(session.permissions, 'inventory.adjustments.approve');
  const canCount = hasPermission(session.permissions, 'inventory.adjustments.create');

  const expected = form.itemId && form.warehouseId ? stock.data?.find((s) => s.itemId === form.itemId && s.warehouseId === form.warehouseId)?.onHand ?? 0 : null;
  const itemName = (id: string) => cat.itemName(id);
  const warehouseName = (id: string) => cat.warehouseName(id);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/v1/inventory/adjustments', { method: 'POST', body: JSON.stringify({ ...form, countedQty: Number(form.countedQty) }) });
      setForm({ itemId: '', warehouseId: '', countedQty: '', reason: '' });
      adjustments.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: 'approve' | 'reject' | 'cancel') {
    setError(null);
    try {
      await api(`/v1/inventory/adjustments/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      adjustments.reload();
      stock.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!cat.ready || !cat.warehouses.data || !adjustments.data || !stock.data) return <section className="page"><Loading /></section>;

  return (
    <section className="page">
      <h1>{tr('Stock adjustments')}</h1>
      <p className="muted">{tr('Cycle counts. A manager approves any variance before it is posted.')}</p>
      {error && <p className="error notice">{error}</p>}
      {canCount && <FormToggle label={tr('New cycle count')}><form className="stack" onSubmit={submit}>
        <div className="form-row">
          <label>{tr('Item')}<select required value={form.itemId} onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}><option value="">{tr('Choose an item…')}</option>{cat.items.data?.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select></label>
          <label>{tr('Warehouse')}<select required value={form.warehouseId} onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}><option value="">{tr('Choose a warehouse…')}</option>{cat.warehouses.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>{tr('Counted quantity')}<input required type="number" min="0" step="0.001" value={form.countedQty} onChange={(e) => setForm((f) => ({ ...f, countedQty: e.target.value }))} />{expected !== null && <span className="muted small">{tr('System quantity:')} {expected}</span>}</label>
        </div>
        <label>{tr('Reason')}<input required value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder={tr('Physical count, damaged stock…')} /></label>
        <div className="form-actions"><Button type="submit" disabled={busy}>{busy ? tr('Submitting…') : tr('Submit count')}</Button></div>
      </form></FormToggle>}
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('Count')}</th><th scope="col">{tr('Item')}</th><th scope="col">{tr('Warehouse')}</th><th scope="col" className="right">{tr('Book')}</th><th scope="col" className="right">{tr('Counted')}</th><th scope="col" className="right">{tr('Difference')}</th><th scope="col">{tr('Status')}</th><th scope="col"><span className="sr-only">{tr('Actions')}</span></th></tr></thead>
          <tbody>
            {adjustments.data.map((a) => <tr key={a.id}><td><code>{a.number}</code><div className="muted small">{a.reason}</div></td><td>{itemName(a.itemId)}</td><td>{warehouseName(a.warehouseId)}</td><td className="right">{a.expectedQty}</td><td className="right"><strong>{a.countedQty}</strong></td><td className={`right ${a.delta < 0 ? 'overdue' : ''}`}>{a.delta > 0 ? `+${a.delta}` : a.delta}</td><td><span className={`pill st-${a.status === 'applied' ? 'approved' : a.status === 'rejected' ? 'rejected' : a.status}`}>{tr(ADJUSTMENT_STATUS[a.status])}</span></td><td>{a.status === 'submitted' && canApprove && <><Button type="submit" onClick={() => act(a.id, 'approve')}>{tr('Approve')}</Button> <Button variant="outline" type="submit" onClick={() => act(a.id, 'reject')}>{tr('Reject')}</Button></>}{a.status === 'submitted' && !canApprove && a.requesterId === session.userId && <Button variant="outline" type="submit" onClick={() => act(a.id, 'cancel')}>{tr('Cancel')}</Button>}</td></tr>)}
            {adjustments.data.length === 0 && <tr><td colSpan={8} className="muted empty">{tr('No stock counts yet.')}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ requests

export function RequestsList() {
  const cat = useCatalog();
  const who = usePeople();
  const requests = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests'));
  const session = useSession();
  const [filter, setFilter] = useState<'all' | 'submitted'>('all');
  const rows = (requests.data ?? []).filter((r) => filter === 'all' || r.status === 'submitted');

  const columns: Column<DemoRequest>[] = [
    { key: 'number', label: tr('Request'), value: (r) => r.number, render: (r) => <Link to={`/inventory/requests/${r.id}`}><code>{r.number}</code></Link> },
    { key: 'by', label: tr('Requested by'), value: (r) => who(r.requesterId) },
    { key: 'wh', label: tr('Warehouse'), value: (r) => cat.warehouseName(r.warehouseId) },
    // A request can carry 20+ lines (a production issue of raw materials). The list shows the first three and a count; the full list is
    // still searched, exported and shown on hover, and the request's own page has every line.
    { key: 'items', label: tr('Items'), value: (r) => r.lines.map((l) => qtyLine(l.qty, cat.itemName(l.itemId))).join(', '), render: (r) => {
      const all = r.lines.map((l) => qtyLine(l.qty, cat.itemName(l.itemId)));
      return <span title={all.join(', ')}>{all.slice(0, 3).map(ltrIsolate).join(', ')}{all.length > 3 && <span className="muted"> {trf('+ {count} more', { count: all.length - 3 })}</span>}</span>;
    } },
    { key: 'status', label: tr('Status'), value: (r) => r.status, render: (r) => <StatusPill status={r.status} /> },
    { key: 'when', label: tr('Requested'), value: (r) => r.createdAt, render: (r) => <span className="nowrap">{formatDateTime(r.createdAt, session.org)}</span> },
  ];

  return (
    <section className="page">
      <h1>{tr('Stock requests')}</h1>
      <p className="muted">{tr('Goods are issued only against an approved request.')}</p>
      {requests.data && cat.ready ? (
        <ListView
          title={tr('Stock requests')}
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => `/inventory/requests/${r.id}`}
          empty={tr('No requests yet.')}
          toolbar={
            <>
              <select className="narrow-select" value={filter} onChange={(e) => setFilter(e.target.value as 'all' | 'submitted')} aria-label={tr('Filter')}>
                <option value="all">{tr('All requests')}</option>
                <option value="submitted">{tr('Waiting for approval')}</option>
              </select>
              {hasPermission(session.permissions, 'inventory.request.create') && <Button type="submit" onClick={() => navigate('/inventory/requests/new')}>{tr('New request')}</Button>}
            </>
          }
        />
      ) : (
        <Loading />
      )}
    </section>
  );
}

function defaultWarehouse(warehouses: { id: string }[], stock: StockRow[], requests: { warehouseId: string }[], lastKey: string): string {
  let last: string | null = null;
  try { last = localStorage.getItem(lastKey); } catch { /* storage blocked */ }
  if (last && warehouses.some((w) => w.id === last)) return last;
  // The warehouse people request from most often (finished goods in a factory). Counting units instead picked the packaging store:
  // thousands of bottles and caps outweigh a few hundred finished products.
  const used = new Map<string, number>();
  for (const r of requests) used.set(r.warehouseId, (used.get(r.warehouseId) ?? 0) + 1);
  const busiest = warehouses.reduce<{ id: string; n: number } | null>((b, w) => ((used.get(w.id) ?? 0) > (b?.n ?? 0) ? { id: w.id, n: used.get(w.id) ?? 0 } : b), null);
  if (busiest) return busiest.id;
  const held = new Map<string, number>();
  for (const s of stock) held.set(s.warehouseId, (held.get(s.warehouseId) ?? 0) + Math.max(0, s.available));
  let best = warehouses[0]?.id ?? '';
  for (const w of warehouses) if ((held.get(w.id) ?? 0) > (held.get(best) ?? 0)) best = w.id;
  return best;
}

export function NewRequest() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const session = useSession();
  const [chosenWarehouse, setWarehouseId] = useState('');
  // Until the person picks one: the warehouse they last requested from (this browser, this company), else the one most requests come
  // from, else the one holding the most stock. The first in the list was often a side store (a cold room) and the request started wrong.
  const past = useLoad(() => api<DemoRequest[]>('/v1/inventory/requests').catch(() => [] as DemoRequest[]));
  const lastKey = `erp.request.warehouse.${session.org?.id ?? ''}`;
  const warehouseId = chosenWarehouse || defaultWarehouse(cat.warehouses.data ?? [], stock.data ?? [], past.data ?? [], lastKey);
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([{ itemId: '', qty: '1' }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = (itemId: string) => stock.data?.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.available ?? 0;
  const setLine = (i: number, patch: Partial<{ itemId: string; qty: string }>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<DemoRequest>('/v1/inventory/requests', {
        method: 'POST',
        body: JSON.stringify({ warehouseId, reason, lines: lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: parseAmount(l.qty) })) }),
      });
      try { localStorage.setItem(lastKey, warehouseId); } catch { /* storage blocked: next time falls back to the fullest warehouse */ }
      navigate(`/inventory/requests/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!cat.ready || !stock.data || !past.data) return <section className="page"><Loading /></section>;

  return (
    <section className="page">
      <Link to="/inventory/requests" className="back-link">{tr('← Stock requests')}</Link>
      <h1>{tr('New stock request')}</h1>
      <p className="muted">{tr('Requested quantities are reserved until a manager decides.')}</p>
      <form className="form-card stack" onSubmit={submit}>
        <div className="form-row">
          <label>
            {tr('Issue from warehouse')}
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {cat.warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>{tr('Reason')}<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('Customer order, internal use…')} /></label>
        </div>
        <strong>{tr('Items')}</strong>
        {lines.map((l, i) => (
          <div className="form-row" key={i}>
            <label>
              {tr('Item')}
              <select value={l.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })}>
                <option value="">{tr('Choose an item…')}</option>
                {cat.items.data?.map((it) => <option key={it.id} value={it.id}>{it.sku} · {it.name}</option>)}
              </select>
            </label>
            <label>
              {tr('Quantity')} {l.itemId && <span className="muted small">{trf('({n} available)', { n: available(l.itemId) })}</span>}
              <input inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
            </label>
          </div>
        ))}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={() => setLines((ls) => [...ls, { itemId: '', qty: '1' }])}>{tr('Add another item')}</Button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <Button type="submit" disabled={busy}>{busy ? tr('Submitting…') : tr('Submit for approval')}</Button>
        </div>
      </form>
    </section>
  );
}

export function RequestPage() {
  const who = usePeople();
  const id = useParam('id');
  const session = useSession();
  const cat = useCatalog();
  const request = useLoad(() => api<DemoRequest>(`/v1/inventory/requests/${id}`));
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const r = request.data;
  // Buttons follow the same permissions as the server, so nobody fills in a form only to be refused (UX audit).
  const isManager = hasPermission(session.permissions, 'inventory.request.approve');
  const mine = r?.requesterId === session.userId;
  const canIssue = hasPermission(session.permissions, 'inventory.stock.issue');
  const canCancel = mine || isManager;

  async function act(action: 'approve' | 'reject' | 'issue' | 'cancel', done: string) {
    setBusy(true);
    setResult(null);
    try {
      await api(`/v1/inventory/requests/${id}/${action}`, { method: 'POST', body: JSON.stringify({ comment }) });
      setResult({ ok: true, text: tr(done) });
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
      request.reload();
    }
  }

  if (request.error) return <section className="page"><p className="error">{request.error}</p></section>;
  if (!r || !cat.ready) return <section className="page"><Loading /></section>;

  const open = r.status === 'submitted' || r.status === 'approved';

  return (
    <section className="page">
      <Link to="/inventory/requests" className="back-link">{tr('← Stock requests')}</Link>
      <div className="page-head">
        <h1 className="mono">{r.number}</h1>
        <StatusPill status={r.status} />
      </div>
      <Steps status={r.status} />
      {/* The key facts as a labelled block, like the invoice and payment pages (was one long sentence). */}
      <dl className="facts">
        <div><dt>{tr('Requested by')}</dt><dd>{who(r.requesterId)}</dd></div>
        <div><dt>{tr('Requested')}</dt><dd>{formatDateTime(r.createdAt, session.org)}</dd></div>
        <div><dt>{tr('Warehouse')}</dt><dd>{cat.warehouseName(r.warehouseId)}</dd></div>
        <div><dt>{tr('Reason')}</dt><dd>{r.reason || <span className="muted">{tr('none given')}</span>}</dd></div>
        {r.source && <div><dt>{tr('Sales order')}</dt><dd><Link to={`/sales/orders/${r.source.id}`}><code>{r.source.number}</code></Link></dd></div>}
        {r.decidedBy && <div><dt>{tr('Decision by')}</dt><dd>{who(r.decidedBy)}{r.decisionComment ? <span className="muted"> · “{r.decisionComment}”</span> : ''}</dd></div>}
      </dl>

      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Quantity')}</th></tr></thead>
          <tbody>
            {r.lines.map((l, i) => <tr key={i}><td>{cat.itemName(l.itemId)}</td><td className="right">{l.qty}</td></tr>)}
          </tbody>
        </table>
      </div>

      {result && <p className={result.ok ? 'notice' : 'error notice'}>{result.text}</p>}

      {/* The person who asked can never approve their own request (a database rule); say so instead of offering Approve (UX audit). */}
      {r.status === 'submitted' && isManager && mine && !demoMode && (
        <p className="notice">{tr('You made this request, so someone else must approve it: another owner or manager.')}</p>
      )}
      {r.status === 'submitted' && isManager && (!mine || demoMode) && (
        <div className="form-card stack">
          <strong>{tr('Manager decision')}</strong>
          <label>{tr('Comment (optional)')}<input value={comment} onChange={(e) => setComment(e.target.value)} /></label>
          <div className="form-actions">
            <Button type="submit" disabled={busy} onClick={() => act('approve', 'Approved. The stock can now be issued.')}>{tr('Approve')}</Button>
            <Button variant="outline" type="submit" disabled={busy} onClick={() => act('reject', 'Rejected. The reserved stock was released.')}>{tr('Reject')}</Button>
          </div>
          {demoMode && <p className="hint muted small">{tr('Try approving a request you submitted yourself: it is refused. Switch person in the yellow bar to approve as someone else.')}</p>}
        </div>
      )}
      {r.status === 'submitted' && !isManager && <p className="notice">{tr('Waiting for a manager to approve.')}{demoMode && tr(' Switch to Layla Hassan or Karim Adel in the yellow bar to approve it.')}</p>}

      {open && (canIssue || canCancel) && (
        <div className="form-actions">
          {r.status === 'approved' && canIssue && (
            <ConfirmButton label={tr('Issue stock')} confirmLabel={tr('Yes, issue')} disabled={busy}
              question={tr('Issue this stock now? It leaves the warehouse and is recorded in the ledger.')}
              onConfirm={() => act('issue', 'Stock issued and recorded in the ledger.')} />
          )}
          {canCancel && (
            <ConfirmButton label={tr('Cancel request')} confirmLabel={tr('Yes, cancel it')} disabled={busy}
              question={tr('Cancel this request? The reserved stock is released.')}
              onConfirm={() => act('cancel', 'Request cancelled. The reserved stock was released.')} />
          )}
        </div>
      )}

      <RecordHistory key={`${r.id}:${r.status}`} id={r.id} />
    </section>
  );
}

// ------------------------------------------------------------------ ledger

/** Plain words for the stock ledger's movement codes (UX audit: the list showed `transfer_out`, `return_in`). */
const MOVE_KIND_LABEL: Record<string, string> = {
  receipt: 'Received', issue: 'Issued', adjust: 'Count adjustment', transfer_out: 'Transfer out', transfer_in: 'Transfer in', return_in: 'Customer return',
};

export function LedgerPage() {
  const who = usePeople();
  const cat = useCatalog();
  const moves = useLoad(() => api<LedgerMove[]>('/v1/inventory/ledger'));
  const session = useSession();

  const columns: Column<LedgerMove>[] = [
    { key: 'when', label: tr('When'), value: (m) => m.postedAt, render: (m) => <span className="nowrap">{formatDateTime(m.postedAt, session.org)}</span> },
    { key: 'item', label: tr('Item'), value: (m) => cat.itemName(m.itemId) },
    { key: 'wh', label: tr('Warehouse'), value: (m) => cat.warehouseName(m.warehouseId) },
    { key: 'kind', label: tr('Type'), value: (m) => m.kind, render: (m) => tr(MOVE_KIND_LABEL[m.kind] ?? m.kind) },
    { key: 'qty', label: tr('Quantity'), value: (m) => m.qty, align: 'right', render: (m) => <strong className={m.qty < 0 ? 'overdue' : undefined}>{m.qty > 0 ? `+${m.qty}` : m.qty}</strong> },
    // UX audit: transfers, adjustments and returns all said "opening stock" here, and the order link was built from a sample-data id.
    { key: 'req', label: tr('Reference'), value: (m) => m.requestNumber ?? m.ref ?? '', render: (m) => (m.requestId ? <Link to={`/inventory/requests/${m.requestId}`}>{m.requestNumber ?? (/^r\d+$/.test(m.requestId) ? `OUT-${m.requestId.slice(1).padStart(4, '0')}` : tr('Request'))}</Link> : m.ref ? <code>{m.ref}</code> : <span className="muted">—</span>) },
    { key: 'by', label: tr('Posted by'), value: (m) => who(m.postedBy) },
  ];

  return (
    <section className="page">
      <h1>{tr('Stock ledger')}</h1>
      <p className="muted">{tr('Every stock movement, newest first. Entries are never edited.')}</p>
      {moves.data && cat.ready ? <ListView title={tr('Stock ledger')} rows={moves.data} columns={columns} rowKey={(m) => String(m.id)} /> : <Loading />}
    </section>
  );
}

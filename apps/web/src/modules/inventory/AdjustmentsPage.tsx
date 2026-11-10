import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { hasPermission } from '@erp/shared';
import { api } from '../../lib/api';
import type { StockAdjustment, StockRow } from '../../lib/demoInventory';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { FormToggle } from '../../components/FormToggle';
import { tr } from '../../lib/i18n';
import { useCatalog } from './inventoryShared';

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


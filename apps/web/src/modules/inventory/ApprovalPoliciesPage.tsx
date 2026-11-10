import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import type { ApprovalPolicy } from '../../lib/demoInventory';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { FormToggle } from '../../components/FormToggle';
import { tr, trf } from '../../lib/i18n';
import { useCatalog } from './inventoryShared';

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


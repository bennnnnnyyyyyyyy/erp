import { useState } from 'react';
import { hasPermission, type Branch } from '@erp/shared';
import { ConfirmButton, FormToggle } from '../../../components/FormToggle';
import { Loading } from '../../../components/Loading';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr, trf } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';
import { Notice, useNotice } from '../../accounting/common';

// Settings > Branches (TREASURY_PLAN.md B1, sql/050): branches inside one company. Warehouses and cash boxes belong to a branch.
// Owners and admins change them (the database checks again). A branch with warehouses, or the last one, cannot be deactivated.

type Warehouse = { id: string; code: string; name: string; branchId: string | null };

export function BranchesSettings() {
  const session = useSession();
  const canManage = hasPermission(session.permissions, 'core.branches.manage');
  const inventoryOn = session.modules.includes('inventory');
  const branches = useLoad(() => api<Branch[]>('/v1/core/branches'));
  const warehouses = useLoad(() => (inventoryOn ? api<Warehouse[]>('/v1/inventory/warehouses') : Promise.resolve([] as Warehouse[])));
  const { message, busy, run } = useNotice();
  const [form, setForm] = useState({ code: '', name: '', nameAr: '' });
  const [edit, setEdit] = useState<{ id: string; code: string; name: string; nameAr: string } | null>(null);
  if (!branches.data || !warehouses.data) return <section className="page"><Loading error={branches.error ?? warehouses.error} /></section>;
  const reload = () => { branches.reload(); warehouses.reload(); };
  const save = (b: Branch, patch: Partial<{ code: string; name: string; nameAr: string; active: boolean }>) => run(async () => {
    await api(`/v1/core/branches/${b.id}`, { method: 'PATCH', body: JSON.stringify({
      code: b.code, name: b.name, nameAr: b.nameAr ?? '', active: b.active, taxBranchId: b.taxBranchId ?? '', ...patch,
    }) });
    return tr('Saved.');
  }, () => { setEdit(null); reload(); });

  return (
    <section className="page">
      <h1>{tr('Branches')}</h1>
      <p className="muted">{tr('Branches of this company. Warehouses and cash boxes belong to a branch; reports by branch come later.')}</p>
      <Notice message={message} />
      {canManage ? (
        <FormToggle label={tr('Add a branch')}>
          <div className="form-row">
            <label>{tr('Code')}<input value={form.code} placeholder="ALX" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
            <label>{tr('Name')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></label>
          </div>
          <div><Button disabled={busy || !form.code.trim() || !form.name.trim()} onClick={() => run(async () => {
            await api('/v1/core/branches', { method: 'POST', body: JSON.stringify(form) });
            return trf('Branch {code} added.', { code: form.code });
          }, () => { setForm({ code: '', name: '', nameAr: '' }); reload(); })}>{tr('Add branch')}</Button></div>
        </FormToggle>
      ) : null}

      {branches.data.map((b) => {
        const own = warehouses.data!.filter((w) => w.branchId === b.id);
        return (
          <div key={b.id} className="form-card stack">
            {edit?.id === b.id ? (
              <div className="form-row">
                <label>{tr('Code')}<input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></label>
                <label>{tr('Name')}<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                <label>{tr('Name in Arabic (optional)')}<input dir="rtl" value={edit.nameAr} onChange={(e) => setEdit({ ...edit, nameAr: e.target.value })} /></label>
                <Button disabled={busy || !edit.code.trim() || !edit.name.trim()} onClick={() => save(b, edit)}>{tr('Save')}</Button>
                <Button variant="ghost" onClick={() => setEdit(null)}>{tr('Cancel')}</Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <h2><code>{b.code}</code> · {b.name}{b.nameAr ? <span className="muted" dir="rtl"> · {b.nameAr}</span> : null}</h2>
                {!b.active ? <span className="muted small">{tr('Inactive')}</span> : null}
                <span className="spacer" />
                {canManage ? <Button size="sm" variant="ghost" onClick={() => setEdit({ id: b.id, code: b.code, name: b.name, nameAr: b.nameAr ?? '' })}>{tr('Edit')}</Button> : null}
                {canManage ? (b.active
                  ? <ConfirmButton size="sm" label={tr('Deactivate')} confirmLabel={tr('Yes, deactivate')} question={tr('Deactivate this branch? Move its warehouses first.')} disabled={busy} onConfirm={() => save(b, { active: false })} />
                  : <Button size="sm" variant="outline" disabled={busy} onClick={() => save(b, { active: true })}>{tr('Reactivate')}</Button>) : null}
              </div>
            )}
            {inventoryOn ? (
              <div>
                <p className="muted small">{own.length ? trf('Warehouses: {list}', { list: own.map((w) => `${w.code} ${w.name}`).join(', ') }) : tr('No warehouses in this branch.')}</p>
                {canManage ? (
                  <label className="small">{tr('Move a warehouse here')}
                    <select value="" disabled={busy || !b.active} onChange={(e) => {
                      const id = e.target.value;
                      if (id) run(async () => {
                        await api(`/v1/inventory/warehouses/${id}/branch`, { method: 'PUT', body: JSON.stringify({ branchId: b.id }) });
                        return tr('Saved.');
                      }, reload);
                    }}>
                      <option value="">{tr('Choose…')}</option>
                      {warehouses.data!.filter((w) => w.branchId !== b.id).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

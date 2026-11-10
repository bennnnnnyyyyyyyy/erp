import { useState } from 'react';
import { formatDay } from '../../lib/format';
import { Loading } from '../../components/Loading';
import { Button } from '../../components/ui/button';
import { ReceiveBatchForm } from './ReceiveBatchForm';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';

import { tr, trf } from '../../lib/i18n';
// Batches (lots) with expiry dates, quarantine and storage conditions (sql/026). Stock of a batch-tracked item is issued
// first-expiry-first-out by the database; quarantined and expired batches are never issued.

type Batch = { id: string; itemId: string; batchNo: string; mfgDate: string | null; expiryDate: string | null; status: 'available' | 'quarantined'; stock: { warehouseId: string; qty: number }[] };
type Expiry = { batchId: string; sku: string; name: string; batchNo: string; qty: number; expiryDate: string; daysLeft: number; status: string };
type Item = { id: string; sku: string; name: string; tracksBatches: boolean; storageConditionId: string | null };
type Named = { id: string; name: string };
type Condition = { id: string; name: string; minTempC: number | null; maxTempC: number | null };

const range = (c: Condition) => (c.minTempC !== null && c.maxTempC !== null ? ` (${c.minTempC} to ${c.maxTempC} °C)` : '');

function bucket(days: number): { label: string; pill: string } {
  if (days < 0) return { label: tr('Expired'), pill: 'rejected' };
  if (days <= 30) return { label: tr('Within 30 days'), pill: 'rejected' };
  if (days <= 60) return { label: tr('Within 60 days'), pill: 'submitted' };
  return { label: tr('Within 90 days'), pill: 'ordered' };
}

export function BatchesPage() {
  const session = useSession();
  const batches = useLoad(() => api<Batch[]>('/v1/inventory/batches'));
  const expiry = useLoad(() => api<Expiry[]>('/v1/inventory/expiry?days=90'));
  const items = useLoad(() => api<Item[]>('/v1/inventory/items'));
  const warehouses = useLoad(() => api<Named[]>('/v1/inventory/warehouses'));
  const conditions = useLoad(() => api<Condition[]>('/v1/inventory/storage-conditions'));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cond, setCond] = useState({ name: '', min: '', max: '' });
  const canReceive = session.permissions.includes('inventory.batches.receive');
  const canManage = session.permissions.includes('inventory.batches.manage');

  async function run(work: () => Promise<string>, after: () => void) {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await work() }); after(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const reloadAll = () => { batches.reload(); expiry.reload(); };

  if (!batches.data || !expiry.data || !items.data || !warehouses.data || !conditions.data) return <section className="page"><Loading error={batches.error} /></section>;
  const item = (id: string) => { const i = items.data?.find((v) => v.id === id); return i ? `${i.sku} · ${i.name}` : id; };
  const wh = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;

  return (
    <section className="page wide">
      <h1>{tr('Batches and expiry')}</h1>
      <p className="muted">{tr('Batch and expiry tracking. Stock is issued first-expiry, first-out (FEFO).')}</p>
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}

      {canReceive && <ReceiveBatchForm items={items.data} warehouses={warehouses.data} onReceived={reloadAll} />}

      <h2 className="related">{tr('Expiring in the next 90 days')}</h2>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Item')}</th><th scope="col">{tr('Batch')}</th><th scope="col" className="right">{tr('Quantity')}</th><th scope="col">{tr('Expires')}</th><th scope="col">{tr('When')}</th><th scope="col">{tr('Status')}</th></tr></thead><tbody>
        {expiry.data.map((e) => { const b = bucket(e.daysLeft); return (
          <tr key={`${e.batchId}`}><td>{e.sku} · {e.name}</td><td><code>{e.batchNo}</code></td><td className="right">{e.qty}</td><td>{formatDay(e.expiryDate, session.org)}</td><td><Pill status={b.pill} label={e.daysLeft < 0 ? trf('Expired {n} days ago', { n: -e.daysLeft }) : trf('{n} days left', { n: e.daysLeft })} /></td><td>{e.status === 'quarantined' ? <Pill status="rejected" label={tr('Quarantined')} /> : ''}</td></tr>); })}
        {!expiry.data.length && <tr><td colSpan={6} className="muted empty">{tr('Nothing expires in the next 90 days.')}</td></tr>}
      </tbody></table></div>

      <h2 className="related">{tr('All batches')}</h2>
      <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Item')}</th><th scope="col">{tr('Batch')}</th><th scope="col">{tr('Made')}</th><th scope="col">{tr('Expires')}</th><th scope="col">{tr('Stock')}</th><th scope="col">{tr('Status')}</th><th scope="col"><span className="sr-only">{tr('Actions')}</span></th></tr></thead><tbody>
        {batches.data.map((b) => (
          <tr key={b.id}><td>{item(b.itemId)}</td><td><code>{b.batchNo}</code></td><td>{formatDay(b.mfgDate, session.org) || '—'}</td><td>{formatDay(b.expiryDate, session.org) || '—'}</td>
            <td>{b.stock.filter((s) => s.qty > 0).map((s) => `${s.qty} in ${wh(s.warehouseId)}`).join(', ') || '0'}</td>
            <td><Pill status={b.status === 'quarantined' ? 'rejected' : 'received'} label={b.status === 'quarantined' ? tr('Quarantined') : tr('Available')} /></td>
            <td>{canManage && <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => {
              const to = b.status === 'quarantined' ? 'available' : 'quarantined';
              await api(`/v1/inventory/batches/${b.id}/status`, { method: 'POST', body: JSON.stringify({ status: to }) });
              return trf('Batch {no} is now {status}.', { no: b.batchNo, status: tr(to) });
            }, reloadAll)}>{b.status === 'quarantined' ? tr('Release') : tr('Quarantine')}</Button>}</td></tr>
        ))}
        {!batches.data.length && <tr><td colSpan={7} className="muted empty">{canReceive ? tr('No batches yet. Use "Receive a batch" above to add the first one.') : tr('No batches yet.')}</td></tr>}
      </tbody></table></div>

      <h2 className="related">{tr('Storage conditions')}</h2>
      <p className="muted small">{tr('Name the places stock must be kept (for example Cold room 2 to 8 °C). An item with a condition cannot be received into a warehouse with a different one.')}</p>
      <ul>{conditions.data.map((c) => <li key={c.id}>{c.name}{range(c)}</li>)}{!conditions.data.length && <li className="muted">{tr('None yet.')}</li>}</ul>
      {canManage && (
        <div className="form-row">
          <label>{tr('Name')}<input value={cond.name} onChange={(e) => setCond({ ...cond, name: e.target.value })} /></label>
          <label>{tr('From °C')}<input inputMode="decimal" value={cond.min} onChange={(e) => setCond({ ...cond, min: e.target.value })} /></label>
          <label>{tr('To °C')}<input inputMode="decimal" value={cond.max} onChange={(e) => setCond({ ...cond, max: e.target.value })} /></label>
          <Button variant="outline" disabled={busy || !cond.name.trim()} onClick={() => run(async () => {
            await api('/v1/inventory/storage-conditions', { method: 'POST', body: JSON.stringify({ name: cond.name, minTempC: cond.min, maxTempC: cond.max }) });
            return trf('Condition "{name}" added.', { name: cond.name.trim() });
          }, () => { setCond({ name: '', min: '', max: '' }); conditions.reload(); })}>{tr('Add condition')}</Button>
        </div>
      )}

      {canManage && (
        <>
          <h2 className="related">{tr('Batch tracking per item')}</h2>
          <p className="muted small">{tr('Switch on for items that expire. Existing stock moves into an "UNBATCHED" lot that is issued last. Choose where the item must be kept.')}</p>
          <div className="table-wrap"><table><thead><tr><th scope="col">{tr('Item')}</th><th scope="col">{tr('Tracking')}</th><th scope="col">{tr('Storage condition')}</th><th scope="col"><span className="sr-only">{tr('Actions')}</span></th></tr></thead><tbody>
            {items.data.map((i) => (
              <tr key={i.id}><td>{i.sku} · {i.name}</td><td>{i.tracksBatches ? tr('On') : tr('Off')}</td>
                <td><select value={i.storageConditionId ?? ''} aria-label={trf('Storage condition for {sku}', { sku: i.sku })} onChange={(e) => run(async () => { await api(`/v1/inventory/items/${i.id}/batching`, { method: 'POST', body: JSON.stringify({ tracks: i.tracksBatches, conditionId: e.target.value }) }); return trf('Storage for {sku} saved.', { sku: i.sku }); }, () => items.reload())}>
                  <option value="">{tr('No requirement')}</option>{(conditions.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                <td><Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/inventory/items/${i.id}/batching`, { method: 'POST', body: JSON.stringify({ tracks: !i.tracksBatches, conditionId: i.storageConditionId ?? '' }) }); return trf(i.tracksBatches ? '{sku}: batch tracking off.' : '{sku}: batch tracking on.', { sku: i.sku }); }, () => items.reload())}>{i.tracksBatches ? tr('Turn off') : tr('Turn on')}</Button></td></tr>
            ))}
          </tbody></table></div>
        </>
      )}
    </section>
  );
}
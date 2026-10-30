import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { Pill } from '../trade/common';

// Batches (lots) with expiry dates, quarantine and storage conditions (sql/026). Stock of a batch-tracked item is issued
// first-expiry-first-out by the database; quarantined and expired batches are never issued.

type Batch = { id: string; itemId: string; batchNo: string; mfgDate: string | null; expiryDate: string | null; status: 'available' | 'quarantined'; stock: { warehouseId: string; qty: number }[] };
type Expiry = { batchId: string; sku: string; name: string; batchNo: string; qty: number; expiryDate: string; daysLeft: number; status: string };
type Item = { id: string; sku: string; name: string; tracksBatches: boolean; storageConditionId: string | null };
type Named = { id: string; name: string };
type Condition = { id: string; name: string; minTempC: number | null; maxTempC: number | null };

const range = (c: Condition) => (c.minTempC !== null && c.maxTempC !== null ? ` (${c.minTempC} to ${c.maxTempC} °C)` : '');

function bucket(days: number): { label: string; pill: string } {
  if (days < 0) return { label: 'Expired', pill: 'rejected' };
  if (days <= 30) return { label: 'Within 30 days', pill: 'rejected' };
  if (days <= 60) return { label: 'Within 60 days', pill: 'submitted' };
  return { label: 'Within 90 days', pill: 'ordered' };
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
  const [f, setF] = useState({ itemId: '', warehouseId: '', batchNo: '', qty: '', mfg: '', exp: '' });
  const [cond, setCond] = useState({ name: '', min: '', max: '' });
  const canReceive = session.permissions.includes('inventory.batches.receive');
  const canManage = session.permissions.includes('inventory.batches.manage');

  async function run(work: () => Promise<string>, after: () => void) {
    setBusy(true); setMsg(null);
    try { setMsg({ ok: true, text: await work() }); after(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const reloadAll = () => { batches.reload(); expiry.reload(); };

  if (!batches.data || !expiry.data || !items.data || !warehouses.data || !conditions.data) return <section className="page"><p className="muted">{batches.error ?? 'Loading…'}</p></section>;
  const item = (id: string) => { const i = items.data?.find((v) => v.id === id); return i ? `${i.sku} · ${i.name}` : id; };
  const wh = (id: string) => warehouses.data?.find((w) => w.id === id)?.name ?? id;

  return (
    <section className="page wide">
      <h1>Batches and expiry</h1>
      <p className="muted">Stock that expires is kept in batches. The system always issues the batch that expires first, and never issues a quarantined or expired batch. Owners and admins switch batch tracking on per item at the bottom of this page.</p>
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}

      <h2 className="related">Expiring in the next 90 days</h2>
      <div className="table-wrap"><table><thead><tr><th>Item</th><th>Batch</th><th className="right">Quantity</th><th>Expires</th><th>When</th><th>Status</th></tr></thead><tbody>
        {expiry.data.map((e) => { const b = bucket(e.daysLeft); return (
          <tr key={`${e.batchId}`}><td>{e.sku} · {e.name}</td><td><code>{e.batchNo}</code></td><td className="right">{e.qty}</td><td>{e.expiryDate}</td><td><Pill status={b.pill} label={e.daysLeft < 0 ? `Expired ${-e.daysLeft} days ago` : `${e.daysLeft} days left`} /></td><td>{e.status === 'quarantined' ? <Pill status="rejected" label="Quarantined" /> : ''}</td></tr>); })}
        {!expiry.data.length && <tr><td colSpan={6} className="muted empty">Nothing expires in the next 90 days.</td></tr>}
      </tbody></table></div>

      {canReceive && (
        <div className="form-card stack">
          <h2>Receive a batch</h2>
          <div className="form-row">
            <label>Item<select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Choose…</option>{items.data.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select></label>
            <label>Warehouse<select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">Choose…</option>{warehouses.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
            <label>Batch number<input value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} /></label>
            <label>Quantity<input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
          </div>
          <div className="form-row">
            <label>Made on (optional)<input type="date" value={f.mfg} onChange={(e) => setF({ ...f, mfg: e.target.value })} /></label>
            <label>Expires on<input type="date" value={f.exp} onChange={(e) => setF({ ...f, exp: e.target.value })} /></label>
          </div>
          <div><Button disabled={busy || !f.itemId || !f.warehouseId || !f.batchNo.trim() || !(Number(f.qty) > 0)} onClick={() => run(async () => {
            await api('/v1/inventory/batches', { method: 'POST', body: JSON.stringify({ itemId: f.itemId, warehouseId: f.warehouseId, batchNo: f.batchNo, qty: Number(f.qty), mfgDate: f.mfg, expiryDate: f.exp }) });
            return `Batch ${f.batchNo.trim()} received.`;
          }, () => { setF({ ...f, batchNo: '', qty: '', mfg: '', exp: '' }); reloadAll(); })}>{busy ? 'Saving…' : 'Receive batch'}</Button></div>
        </div>
      )}

      <h2 className="related">All batches</h2>
      <div className="table-wrap"><table><thead><tr><th>Item</th><th>Batch</th><th>Made</th><th>Expires</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>
        {batches.data.map((b) => (
          <tr key={b.id}><td>{item(b.itemId)}</td><td><code>{b.batchNo}</code></td><td>{b.mfgDate ?? '—'}</td><td>{b.expiryDate ?? '—'}</td>
            <td>{b.stock.filter((s) => s.qty > 0).map((s) => `${s.qty} in ${wh(s.warehouseId)}`).join(', ') || '0'}</td>
            <td><Pill status={b.status === 'quarantined' ? 'rejected' : 'received'} label={b.status === 'quarantined' ? 'Quarantined' : 'Available'} /></td>
            <td>{canManage && <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => {
              const to = b.status === 'quarantined' ? 'available' : 'quarantined';
              await api(`/v1/inventory/batches/${b.id}/status`, { method: 'POST', body: JSON.stringify({ status: to }) });
              return `Batch ${b.batchNo} is now ${to}.`;
            }, reloadAll)}>{b.status === 'quarantined' ? 'Release' : 'Quarantine'}</Button>}</td></tr>
        ))}
        {!batches.data.length && <tr><td colSpan={7} className="muted empty">No batches yet.</td></tr>}
      </tbody></table></div>

      <h2 className="related">Storage conditions</h2>
      <p className="muted small">Name the places stock must be kept (for example Cold room 2 to 8 °C). An item with a condition cannot be received into a warehouse with a different one.</p>
      <ul>{conditions.data.map((c) => <li key={c.id}>{c.name}{range(c)}</li>)}{!conditions.data.length && <li className="muted">None yet.</li>}</ul>
      {canManage && (
        <div className="form-row">
          <label>Name<input value={cond.name} onChange={(e) => setCond({ ...cond, name: e.target.value })} /></label>
          <label>From °C<input inputMode="decimal" value={cond.min} onChange={(e) => setCond({ ...cond, min: e.target.value })} /></label>
          <label>To °C<input inputMode="decimal" value={cond.max} onChange={(e) => setCond({ ...cond, max: e.target.value })} /></label>
          <Button variant="outline" disabled={busy || !cond.name.trim()} onClick={() => run(async () => {
            await api('/v1/inventory/storage-conditions', { method: 'POST', body: JSON.stringify({ name: cond.name, minTempC: cond.min, maxTempC: cond.max }) });
            return `Condition "${cond.name.trim()}" added.`;
          }, () => { setCond({ name: '', min: '', max: '' }); conditions.reload(); })}>Add condition</Button>
        </div>
      )}

      {canManage && (
        <>
          <h2 className="related">Batch tracking per item</h2>
          <p className="muted small">Switch on for items that expire (creams, oils, actives). Existing stock moves into an "UNBATCHED" lot that is issued last. Choose where the item must be kept.</p>
          <div className="table-wrap"><table><thead><tr><th>Item</th><th>Tracking</th><th>Must be stored</th><th></th></tr></thead><tbody>
            {items.data.map((i) => (
              <tr key={i.id}><td>{i.sku} · {i.name}</td><td>{i.tracksBatches ? 'On' : 'Off'}</td>
                <td><select value={i.storageConditionId ?? ''} onChange={(e) => run(async () => { await api(`/v1/inventory/items/${i.id}/batching`, { method: 'POST', body: JSON.stringify({ tracks: i.tracksBatches, conditionId: e.target.value }) }); return `Storage for ${i.sku} saved.`; }, () => items.reload())}>
                  <option value="">Anywhere</option>{(conditions.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                <td><Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/inventory/items/${i.id}/batching`, { method: 'POST', body: JSON.stringify({ tracks: !i.tracksBatches, conditionId: i.storageConditionId ?? '' }) }); return `${i.sku}: batch tracking ${i.tracksBatches ? 'off' : 'on'}.`; }, () => items.reload())}>{i.tracksBatches ? 'Turn off' : 'Turn on'}</Button></td></tr>
            ))}
          </tbody></table></div>
        </>
      )}
    </section>
  );
}
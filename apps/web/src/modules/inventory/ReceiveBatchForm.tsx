import { useState } from 'react';
import { FormToggle } from '../../components/FormToggle';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { Link } from '../../lib/router';

// The "Receive a batch" form (sql/026): stock of a batch-tracked item comes in with a batch number and an expiry date. Used on the
// Receive goods page and on Batches and expiry; the same API call as before.

type Item = { id: string; sku: string; name: string; tracksBatches: boolean };
type Named = { id: string; name: string };

export function ReceiveBatchForm({ items, warehouses, open, onOpenChange, onReceived }: {
  items: Item[]; warehouses: Named[]; open?: boolean; onOpenChange?: (open: boolean) => void; onReceived?: () => void;
}) {
  const [f, setF] = useState({ itemId: '', warehouseId: '', batchNo: '', qty: '', mfg: '', exp: '', cost: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const tracked = items.filter((i) => i.tracksBatches);

  async function receive() {
    setBusy(true); setMsg(null);
    try {
      await api('/v1/inventory/batches', { method: 'POST', body: JSON.stringify({ itemId: f.itemId, warehouseId: f.warehouseId, batchNo: f.batchNo, qty: Number(f.qty), mfgDate: f.mfg, expiryDate: f.exp, unitCostMinor: f.cost.trim() ? Math.round(Number(f.cost) * 100) : null }) });
      setMsg({ ok: true, text: trf('Batch {no} received.', { no: f.batchNo.trim() }) });
      setF({ ...f, batchNo: '', qty: '', mfg: '', exp: '', cost: '' });
      onReceived?.();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {msg && <p className={msg.ok ? 'notice' : 'error notice'}>{msg.text}</p>}
      <FormToggle label={tr('Receive a batch')} open={open} onOpenChange={onOpenChange}>
        <p className="muted small">{tr('Stock goes up as soon as you press Receive batch. Stock is issued first-expiry, first-out.')}</p>
        {tracked.length === 0 && (
          <p className="notice">{tr('No item is tracked by batch yet. Open an item under Stock on hand and switch on Batches, or tick "Track batches and expiry dates" when you add it.')} <Link to="/inventory/stock">{tr('Stock on hand')}</Link></p>
        )}
        <div className="form-row">
          <label>{tr('Item')}<select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">{tr('Choose…')}</option>{tracked.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select></label>
          <label>{tr('Warehouse')}<select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}><option value="">{tr('Choose…')}</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>{tr('Batch number')}<input value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} /></label>
          <label>{tr('Quantity')}<input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
          <label>{tr('Made on (optional)')}<input type="date" value={f.mfg} onChange={(e) => setF({ ...f, mfg: e.target.value })} /></label>
          <label>{tr('Expires on')}<input type="date" value={f.exp} onChange={(e) => setF({ ...f, exp: e.target.value })} /></label>
          {/* sql/046: the cost of what was received. Required once accounting is on; otherwise optional (it also updates the average cost). */}
          <label>{tr('Unit cost (needed with accounting)')}<input inputMode="decimal" placeholder="0.00" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></label>
        </div>
        <div><Button disabled={busy || !f.itemId || !f.warehouseId || !f.batchNo.trim() || !(Number(f.qty) > 0)} onClick={receive}>{busy ? tr('Saving…') : tr('Receive batch')}</Button></div>
      </FormToggle>
    </>
  );
}

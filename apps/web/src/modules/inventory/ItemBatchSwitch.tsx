import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { tr } from '../../lib/i18n';
import { Link } from '../../lib/router';

// "Batches: on/off" on the item page, with a switch for people who may change it (same call as Batches and expiry, per item).
// Switching on moves existing stock into an UNBATCHED lot, so the switch asks nothing but says so.

export function ItemBatchSwitch({ itemId, tracks, conditionId, canManage, onChanged }: {
  itemId: string; tracks: boolean; conditionId: string | null; canManage: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip() {
    setBusy(true); setError(null);
    try {
      await api(`/v1/inventory/items/${itemId}/batching`, { method: 'POST', body: JSON.stringify({ tracks: !tracks, conditionId: conditionId ?? '' }) });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-card stack">
      <div className="option-row" style={{ borderBlockStart: 0, paddingBlock: 0 }}>
        <div>
          <strong>{tracks ? tr('Batches: on') : tr('Batches: off')}</strong>
          <p className="muted small">
            {tracks
              ? tr('Every receipt of this item has a batch number and an expiry date. Enter them under Receive goods, Batch.')
              : tr('Switch batches on for items that expire. Without it, stock of this item has no batch number or expiry date.')}
          </p>
        </div>
        <div className="form-actions">
          {tracks && <Link to="/inventory/receive">{tr('Receive a batch')}</Link>}
          {canManage && <Button variant="outline" size="sm" disabled={busy} onClick={flip}>{tracks ? tr('Turn off') : tr('Turn on')}</Button>}
        </div>
      </div>
      {canManage && !tracks && <p className="muted small">{tr('Existing stock moves into an UNBATCHED lot that is issued last.')}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

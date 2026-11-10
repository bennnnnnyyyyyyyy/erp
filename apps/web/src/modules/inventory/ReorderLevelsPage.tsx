import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import type { DemoItem, StockRow } from '../../lib/demoInventory';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { tr, trf } from '../../lib/i18n';
import { useCatalog } from './inventoryShared';

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


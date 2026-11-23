import { useState } from 'react';
import { localName, unitLabel } from '../../lib/names';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/Loading';
import { api } from '../../lib/api';
import type { DemoItem, StockRow } from '../../lib/demoInventory';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';
import { tr, trf } from '../../lib/i18n';
import { formatQty } from '../../lib/numbers';
import { useCatalog } from './inventoryShared';

// ------------------------------------------------------------------ reorder levels

type ReorderLine = DemoItem & { available: number; onHand: number; reserved: number; low: boolean };

export function ReorderLevelsPage() {
  const cat = useCatalog();
  const stock = useLoad(() => api<StockRow[]>('/v1/inventory/stock'));
  const session = useSession();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
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

  // UX audit 20 Nov: a black Save button on every row. Now one "Save changes" saves every changed box. Each row has two boxes: the
  // reorder level and (sql/106, low stock pop-up) the maximum level an order fills stock up to. Drafts are keyed "<item id>:level|max".
  type Field = 'level' | 'max';
  const savedOf = (row: ReorderLine, f: Field) => {
    const v = f === 'level' ? row.reorderLevel : (row.maxLevel ?? null);
    return v === null ? '' : String(v);
  };
  const valueOf = (row: ReorderLine, f: Field) => drafts[`${row.id}:${f}`] ?? savedOf(row, f);
  const changed = rows.flatMap((row) =>
    (['level', 'max'] as Field[]).filter((f) => drafts[`${row.id}:${f}`] !== undefined && drafts[`${row.id}:${f}`]!.trim() !== savedOf(row, f)).map((f) => ({ row, f })),
  );

  async function saveAll() {
    const bad = changed.find(({ row, f }) => {
      const raw = drafts[`${row.id}:${f}`]!.trim();
      return raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0);
    });
    if (bad) {
      setError(trf('{sku}: a reorder level must be zero or more, or empty.', { sku: bad.row.sku }));
      return;
    }
    setSaving(true);
    setNotice(null);
    setError(null);
    let saved = 0;
    try {
      for (const { row, f } of changed) {
        const key = `${row.id}:${f}`;
        const raw = drafts[key]!.trim();
        const level = raw === '' ? null : Number(raw);
        if (f === 'level') await api(`/v1/inventory/items/${row.id}/reorder-level`, { method: 'POST', body: JSON.stringify({ level }) });
        else await api(`/v1/inventory/items/${row.id}/max-level`, { method: 'PUT', body: JSON.stringify({ level }) });
        saved += 1;
        setDrafts((cur) => { const next = { ...cur }; delete next[key]; return next; });
      }
      setNotice(trf('{n} reorder level(s) saved.', { n: saved }));
    } catch (err) {
      setError(`${saved ? trf('{n} reorder level(s) saved.', { n: saved }) + ' ' : ''}${(err as Error).message}`);
    } finally {
      setSaving(false);
      cat.items.reload();
    }
  }

  if (!cat.ready || !stock.data) return <section className="page"><Loading /></section>;

  return (
    <section className="page">
      <h1>{tr('Reorder levels')}</h1>
      <div className="page-head">
        <p className="muted">{tr('Minimum available quantity per item before reordering.')}</p>
        {canManage && <span style={{ marginInlineStart: 'auto' }}><Button disabled={saving || changed.length === 0} onClick={() => void saveAll()}>{saving ? tr('Saving…') : changed.length ? trf('Save changes ({n})', { n: changed.length }) : tr('Save changes')}</Button></span>}
      </div>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error notice">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">SKU</th><th scope="col">{tr('Item')}</th><th scope="col" className="right">{tr('Available')}</th><th scope="col" className="right">{tr('Reorder level')}</th><th scope="col" className="right" title={tr('Orders fill stock up to this level (optional).')}>{tr('Maximum')}</th><th scope="col">{tr('Status')}</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const value = valueOf(row, 'level');
              return (
                <tr key={row.id}>
                  <td><code>{row.sku}</code></td>
                  <td><strong>{localName(row)}</strong><div className="muted small">{trf('{qty} {unit} reserved', { qty: formatQty(row.reserved), unit: unitLabel(row.uom) })}</div></td>
                  {/* Walkthrough 18 Nov: "139.029" with no unit; the quantity now reads "139.029 litre". */}
                  <td className="right"><strong>{formatQty(row.available)}</strong> <span className="muted small">{unitLabel(row.uom)}</span></td>
                  <td className="right">
                    {canManage ? (
                      <span className="flex items-center gap-2">
                        <input className="narrow-input" type="number" min="0" step="0.001" aria-label={trf('Reorder level for {sku}', { sku: row.sku })} value={value} onChange={(e) => setDrafts((current) => ({ ...current, [`${row.id}:level`]: e.target.value }))} placeholder={tr('Not watched')} />
                        <span className="muted small">{unitLabel(row.uom)}</span>
                      </span>
                    ) : row.reorderLevel === null ? tr('Not watched') : `${formatQty(row.reorderLevel)} ${unitLabel(row.uom)}`}
                  </td>
                  <td className="right">
                    {canManage ? (
                      <input className="narrow-input" type="number" min="0" step="0.001" aria-label={trf('Maximum level for {sku}', { sku: row.sku })} value={valueOf(row, 'max')} onChange={(e) => setDrafts((current) => ({ ...current, [`${row.id}:max`]: e.target.value }))} placeholder="—" />
                    ) : row.maxLevel == null ? '—' : formatQty(row.maxLevel)}
                  </td>
                  <td>{row.reorderLevel === null ? <span className="muted">{tr('Not watched')}</span> : row.low ? <span className="pill st-rejected">{tr('Low stock')}</span> : <span className="pill st-approved">{tr('Healthy')}</span>}</td>
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


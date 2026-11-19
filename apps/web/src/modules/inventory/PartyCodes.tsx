import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { demoMode } from '../../lib/demo';
import { tr, trf } from '../../lib/i18n';
import { useLoad } from '../../lib/useLoad';

// Supplier and customer item codes (sql/099, documentation/plans/MASTER_DATA_PLAN.md slice B): the code a supplier or customer uses for
// one of our items. Shown beside ours on orders, bills and invoices ("Their code"), and searchable when picking items for that party.
// Only owners and admins change them (Ben, 18 Nov; the database re-checks).

export type PartyType = 'supplier' | 'customer';
export type PartyCode = { itemId: string; partyType: PartyType; partyId: string; code: string; name: string };
type Party = { id: string; name: string; code?: string };

/** One party's codes by item id (empty until a party is chosen, in the sample-data build, or before sql/099). */
export function usePartyCodes(partyType: PartyType, partyId: string | null | undefined): Map<string, string> {
  const [codes, setCodes] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (demoMode || !partyId) return setCodes(new Map());
    let live = true;
    api<PartyCode[]>(`/v1/inventory/party-item-codes?partyType=${partyType}&partyId=${partyId}`)
      .then((rows) => live && setCodes(new Map(rows.map((r) => [r.itemId, r.code]))))
      .catch(() => live && setCodes(new Map()));
    return () => {
      live = false;
    };
  }, [partyType, partyId]);
  return codes;
}

export { codesFor } from './partyCodeUtils';

/** "Their code" header and cell, shown only when at least one line has a code. */
export function TheirCodeHeader({ codes }: { codes: Map<string, string> }) {
  return codes.size ? <th scope="col">{tr('Their code')}</th> : null;
}
export function TheirCodeCell({ codes, itemId }: { codes: Map<string, string>; itemId: string | undefined }) {
  if (!codes.size) return null;
  const code = itemId ? codes.get(itemId) : undefined;
  return <td>{code ? <code>{code}</code> : <span className="muted">—</span>}</td>;
}

/** The item page's "Supplier and customer codes" section. Everyone reads; owners and admins change. */
export function ItemPartyCodes({ itemId, canManage }: { itemId: string; canManage: boolean }) {
  const codes = useLoad(() => api<PartyCode[]>(`/v1/inventory/party-item-codes?itemId=${itemId}`));
  const suppliers = useLoad(() => api<Party[]>('/v1/purchasing/suppliers').catch(() => [] as Party[]));
  const customers = useLoad(() => api<Party[]>('/v1/sales/customers').catch(() => [] as Party[]));
  const [form, setForm] = useState<{ party: string; code: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Before sql/099 is applied there is nothing to show.
  if (codes.error || !codes.data) return null;

  const partyName = (c: PartyCode) =>
    (c.partyType === 'supplier' ? suppliers.data : customers.data)?.find((p) => p.id === c.partyId)?.name ?? '—';
  const options = [
    ...(suppliers.data ?? []).map((p) => ({ value: `supplier:${p.id}`, label: trf('Supplier: {name}', { name: p.name }) })),
    ...(customers.data ?? []).map((p) => ({ value: `customer:${p.id}`, label: trf('Customer: {name}', { name: p.name }) })),
  ];

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      setForm(null);
      codes.reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const [partyType, partyId] = form.party.split(':');
    await run(() => api(`/v1/inventory/items/${itemId}/party-codes`, { method: 'PUT', body: JSON.stringify({ partyType, partyId, code: form.code, name: form.name }) }));
  }

  return (
    <div className="form-card stack" role="group" aria-label={tr('Supplier and customer codes')}>
      <strong>{tr('Supplier and customer codes')}</strong>
      <p className="muted small">{tr('The code each supplier or customer uses for this item. It is shown beside ours on their orders, bills and invoices.')}</p>
      {codes.data.length === 0 ? <p className="muted small">{tr('No supplier or customer codes yet.')}</p> : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{tr('Supplier or customer')}</th>
              <th scope="col">{tr('Their code')}</th>
              <th scope="col">{tr('Their name')}</th>
              {canManage ? <th scope="col"><span className="sr-only">{tr('Actions')}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {codes.data.map((c) => (
              <tr key={`${c.partyType}:${c.partyId}`}>
                <td>{c.partyType === 'supplier' ? trf('Supplier: {name}', { name: partyName(c) }) : trf('Customer: {name}', { name: partyName(c) })}</td>
                <td><code>{c.code}</code></td>
                <td>{c.name || <span className="muted">—</span>}</td>
                {canManage ? (
                  <td className="actions">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ party: `${c.partyType}:${c.partyId}`, code: c.code, name: c.name })}>{tr('Edit')}</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void run(() => api(`/v1/inventory/items/${itemId}/party-codes/${c.partyType}/${c.partyId}`, { method: 'DELETE' }))}>{tr('Remove')}</Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canManage && !form ? (
        <div className="form-actions"><Button type="button" variant="outline" onClick={() => setForm({ party: options[0]?.value ?? '', code: '', name: '' })} disabled={!options.length}>{tr('Add a code')}</Button></div>
      ) : null}
      {form ? (
        <form className="stack" onSubmit={save} aria-label={tr('Add a code')}>
          <div className="form-row">
            <label>
              {tr('Supplier or customer')}
              <select required value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label>{tr('Their code')}<input required maxLength={64} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
            <label>{tr('Their name (optional)')}<input maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          </div>
          <div className="form-actions">
            <Button type="submit">{tr('Save code')}</Button>
            <Button type="button" variant="ghost" onClick={() => setForm(null)}>{tr('Cancel')}</Button>
          </div>
        </form>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

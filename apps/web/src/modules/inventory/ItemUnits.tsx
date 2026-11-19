import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { UnitSelect } from '../../components/UnitSelect';
import { api } from '../../lib/api';
import { tr, trf } from '../../lib/i18n';
import { useItemUnits } from '../../lib/useItemUnits';
import { formatQty, parseAmount } from '../../lib/numbers';

// The Units tab of an item (sql/044, slice D sql/101): the base unit, the other units it is bought or sold in (a box = 12 pieces), and
// the unit a new purchase or sales line starts in. Owners and admins change them (the database checks); everyone reads.

type Unit = { id: string; unit: string; factor: number; forPurchase: boolean; forSale: boolean };

export function ItemUnits({ itemId, baseUnit, units, canManage, onChanged }: {
  itemId: string;
  baseUnit: string;
  units: Unit[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const all = useItemUnits();
  const defaults = all.data?.defaults.find((d) => d.itemId === itemId);
  const [unit, setUnit] = useState('box');
  const [factor, setFactor] = useState('');
  const [forPurchase, setForPurchase] = useState(true);
  const [forSale, setForSale] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage({ ok: true, text: tr(done) });
      onChanged();
      all.reload();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const f = parseAmount(factor);
    if (!unit.trim() || !(f > 0)) return setMessage({ ok: false, text: tr('Type the unit and how many base units it holds.') });
    void run(
      () => api(`/v1/inventory/items/${itemId}/units`, { method: 'PUT', body: JSON.stringify({ unit: unit.trim(), factor: f, forPurchase, forSale }) }),
      'Unit saved.',
    ).then(() => setFactor(''));
  }

  const setDefaults = (purchaseUnit: string | null, saleUnit: string | null) =>
    run(() => api(`/v1/inventory/items/${itemId}/default-units`, { method: 'PUT', body: JSON.stringify({ purchaseUnit, saleUnit }) }), 'Default units saved.');

  const buyUnits = units.filter((u) => u.forPurchase);
  const sellUnits = units.filter((u) => u.forSale);

  return (
    <div className="stack">
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{tr('Unit')}</th><th scope="col" className="right">{trf('In {unit}', { unit: tr(baseUnit) })}</th><th scope="col">{tr('Used for')}</th>{canManage ? <th scope="col"><span className="sr-only">{tr('Actions')}</span></th> : null}</tr></thead>
        <tbody>
          <tr><td><strong>{tr(baseUnit)}</strong></td><td className="right">1</td><td className="muted">{tr('Base unit: stock is counted in it')}</td>{canManage ? <td /> : null}</tr>
          {units.map((u) => (
            <tr key={u.id}>
              <td>{tr(u.unit)}</td>
              <td className="right">{formatQty(u.factor)}</td>
              <td>{[u.forPurchase ? tr('Buying') : '', u.forSale ? tr('Selling') : ''].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
              {canManage ? (
                <td className="right">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => api(`/v1/inventory/items/${itemId}/units/${encodeURIComponent(u.unit)}`, { method: 'DELETE' }), 'Unit removed.')}>
                    {tr('Remove')}
                  </Button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table></div>

      {message ? <p className={message.ok ? 'notice' : 'error notice'} role={message.ok ? 'status' : 'alert'}>{message.text}</p> : null}

      {canManage ? (
        <form className="form-card stack" onSubmit={add}>
          <strong>{tr('Add a unit')}</strong>
          <p className="muted small">{trf('For example a box that holds 12 {base}. Orders can then be typed in boxes; stock stays in {base}.', { base: tr(baseUnit) })}</p>
          <div className="form-row">
            <label>{tr('Unit')}<UnitSelect value={unit} onChange={setUnit} label={tr('Unit')} /></label>
            <label>{trf('How many {base} in one', { base: tr(baseUnit) })}<input inputMode="decimal" value={factor} placeholder="12" onChange={(e) => setFactor(e.target.value)} /></label>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={forPurchase} onChange={(e) => setForPurchase(e.target.checked)} />{tr('Buying')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={forSale} onChange={(e) => setForSale(e.target.checked)} />{tr('Selling')}</label>
          </div>
          <div className="form-actions"><Button type="submit" disabled={busy}>{tr('Save unit')}</Button></div>
        </form>
      ) : null}

      {units.length ? (
        <div className="form-card stack">
          <strong>{tr('Units new lines start in')}</strong>
          <p className="muted small">{tr('A new purchase or sales order line for this item starts in this unit; it can still be changed on the line.')}</p>
          <div className="form-row">
            <label>
              {tr('Buying in')}
              <select disabled={!canManage || busy} value={defaults?.purchaseUnit ?? ''} onChange={(e) => setDefaults(e.target.value || null, defaults?.saleUnit ?? null)}>
                <option value="">{tr(baseUnit)}</option>
                {buyUnits.map((u) => <option key={u.id} value={u.unit}>{tr(u.unit)}</option>)}
              </select>
            </label>
            <label>
              {tr('Selling in')}
              <select disabled={!canManage || busy} value={defaults?.saleUnit ?? ''} onChange={(e) => setDefaults(defaults?.purchaseUnit ?? null, e.target.value || null)}>
                <option value="">{tr(baseUnit)}</option>
                {sellUnits.map((u) => <option key={u.id} value={u.unit}>{tr(u.unit)}</option>)}
              </select>
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

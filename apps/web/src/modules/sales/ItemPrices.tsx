import { useState } from 'react';
import { formatMoney } from '@erp/shared';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { parseAmount } from '../../lib/numbers';
import { useLoad } from '../../lib/useLoad';
import { useSession } from '../../session';

// An item's prices on its page (sql/097): its sales price (owners and admins change it), the price lists that have it, each supplier's
// last cost and a suggested price. A purchase never changes the sales price: "Use suggestion" fills the box, and only Save changes it.

const money = (amountMinor: number, currency: string) => formatMoney({ amountMinor, currency });

type Info = {
  currency: string;
  salesPrice: { priceMinor: number; includesVat: boolean } | null;
  priceLists: { priceListId: string; name: string; validFrom: string; validTo: string | null; priceMinor: number; currency: string }[];
  supplierCosts: { supplierId: string; supplierName: string; lastCostMinor: number; currency: string; source: 'bill' | 'order'; sourceNumber: string | null; recordedAt: string }[];
  markupPercent: number | null;
  suggestedPriceMinor: number | null;
};

export function ItemPrices({ itemId, canManage }: { itemId: string; canManage: boolean }) {
  const session = useSession();
  const info = useLoad(() => api<Info>(`/v1/sales/items/${itemId}/prices`));
  const [price, setPrice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Before sql/097 is applied (or without the sales module) there is nothing to show.
  if (info.error || !info.data) return null;
  const d = info.data;
  const current = d.salesPrice ? (d.salesPrice.priceMinor / 100).toFixed(2) : '';
  const value = price ?? current;

  async function save(priceMinor: number | null) {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/sales/items/${itemId}/price`, { method: 'PUT', body: JSON.stringify({ priceMinor }) });
      setPrice(null);
      info.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-card stack" role="group" aria-label={tr('Prices')}>
      <strong>{tr('Prices')}</strong>
      <div className="form-row">
        <label>
          {trf('Sales price ({currency})', { currency: d.currency })}
          <input inputMode="decimal" placeholder="0.00" value={value} disabled={!canManage} onChange={(e) => setPrice(e.target.value)} />
          {d.salesPrice?.includesVat ? <span className="hint muted">{tr('includes VAT')}</span> : null}
        </label>
        {canManage ? (
          <div className="form-actions">
            <Button type="button" disabled={busy || price === null || (value.trim() !== '' && !Number.isFinite(parseAmount(value)))}
              onClick={() => void save(value.trim() === '' ? null : Math.round(parseAmount(value) * 100))}>{tr('Save price')}</Button>
            {d.suggestedPriceMinor !== null ? (
              <Button type="button" variant="outline" onClick={() => setPrice(((d.suggestedPriceMinor ?? 0) / 100).toFixed(2))}>{tr('Use suggestion')}</Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {d.suggestedPriceMinor !== null ? (
        <p className="muted small">
          {d.markupPercent !== null
            ? trf('Suggested: {price} (latest cost plus {markup}%)', { price: money(d.suggestedPriceMinor, d.currency), markup: d.markupPercent })
            : trf('Suggested: {price} (latest cost; set a markup under Sales, Prices)', { price: money(d.suggestedPriceMinor, d.currency) })}
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {d.supplierCosts.length ? (
        <table className="table">
          <thead>
            <tr><th scope="col">{tr('Supplier')}</th><th scope="col" className="right">{tr('Last cost')}</th><th scope="col">{tr('From')}</th></tr>
          </thead>
          <tbody>
            {d.supplierCosts.map((s) => (
              <tr key={`${s.supplierId}-${s.currency}`}>
                <td>{s.supplierName}</td>
                <td className="right">{money(s.lastCostMinor, s.currency)}</td>
                <td className="nowrap">{s.source === 'bill' ? tr('Bill') : tr('Purchase order')} {s.sourceNumber ?? ''} · {formatDay(s.recordedAt, session.org)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted small">{tr('No purchase prices recorded yet. They are recorded from bills and purchase orders.')}</p>}
      {d.priceLists.length ? (
        <ul className="muted small">
          {d.priceLists.map((l) => (
            <li key={l.priceListId}>{trf('{name}: {price} ({from} to {to})', { name: l.name, price: money(l.priceMinor, l.currency), from: l.validFrom, to: l.validTo ?? tr('No end') })}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import { useState } from 'react';
import type { VatSettings } from '@erp/shared';
import { api } from '../../../lib/api';
import { tr, trf } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';

// VAT registration for the whole company (sql/086, documentation/plans/VAT_PLAN.md). Off by default. When on, each new sales invoice
// line carries VAT at the line's rate (the item's default VAT rate, else the company default chosen here). Prices are typed before
// VAT. Invoices issued earlier keep the tax they were issued with. The database checks the role and the rate, and audits the change.
export function VatSettingsCard() {
  const vat = useLoad(() => api<VatSettings>('/v1/core/org/vat'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (vat.error || !vat.data) return null; // an older API without the route: nothing to show
  const v = vat.data;
  const current = v.rates.find((r) => r.id === v.defaultVatRateId);

  async function save(registered: boolean, defaultRateId: string | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await api<{ vatRegistered: boolean; defaultVatRateId: string | null; rateAdded?: boolean }>('/v1/core/org/vat', {
        method: 'PUT',
        body: JSON.stringify({ registered, defaultRateId }),
      });
      if (saved.rateAdded) setNotice(tr('The standard VAT rate (14%) was added as your company rate.'));
      vat.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-card stack">
      <h2>{tr('VAT')}</h2>
      <p className="muted small">
        {tr('When your company is VAT registered, each new sales invoice and credit or debit note shows VAT on every line. Prices are typed before VAT. Invoices issued before you switch on keep no VAT.')}
      </p>
      <ul className="option-list">
        <li className="option-row">
          <div>
            <strong>{tr('VAT registered')}</strong>
            <p className="muted small">
              {v.vatRegistered && current
                ? trf('Default rate: {label} ({rate}%). An item can have its own rate.', { label: current.label, rate: current.rate })
                : tr('Off: invoices carry no VAT.')}
            </p>
          </div>
          <label className="option-switch">
            <input
              type="checkbox"
              role="switch"
              aria-checked={v.vatRegistered}
              checked={v.vatRegistered}
              disabled={busy}
              aria-label={tr('VAT registered')}
              onChange={() => save(!v.vatRegistered, v.defaultVatRateId)}
            />
            <span>{v.vatRegistered ? tr('On') : tr('Off')}</span>
          </label>
        </li>
      </ul>
      {v.vatRegistered && v.rates.length > 0 ? (
        <label>
          {tr('Default VAT rate')}
          <select value={v.defaultVatRateId ?? ''} disabled={busy} onChange={(e) => save(true, e.target.value || null)}>
            {v.rates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({r.rate}%)
              </option>
            ))}
          </select>
          <span className="hint muted">{tr('Used on a line when its item has no VAT rate of its own.')}</span>
        </label>
      ) : null}
      {!v.vatRegistered && v.rates.length === 0 ? (
        <p className="muted small">{tr('Switching on adds the standard VAT rate (14%) for your company.')}</p>
      ) : null}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

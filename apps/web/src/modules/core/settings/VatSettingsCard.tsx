import { DateInput } from '../../../components/DateInput';
import { useState } from 'react';
import type { VatSettings } from '@erp/shared';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { tr, trf } from '../../../lib/i18n';
import { useLoad } from '../../../lib/useLoad';
import { useSession } from '../../../session';

// VAT for the whole company (sql/086-088, documentation/plans/VAT_PLAN.md). Off by default. The company's VAT rates are listed here
// (owners and admins add, change and remove them; 0% export and exempt rates carry their ETA codes). Only an owner switches VAT on or
// off, chooses the default rate and the first day VAT applies (default: the first day of the current month). Prices are typed before
// VAT; documents issued earlier keep the tax they were issued with. The database checks every rule and audits each change.

type RateForm = { id: string | null; subType: string; rate: string; label: string; isDefault: boolean };
const emptyRate: RateForm = { id: null, subType: 'V009', rate: '14', label: '', isDefault: false };

export function VatSettingsCard() {
  const session = useSession();
  const isOwner = session.role === 'owner';
  const vat = useLoad(() => api<VatSettings>('/v1/core/org/vat'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [form, setForm] = useState<RateForm | null>(null);
  const [dueDays, setDueDays] = useState<string | null>(null);
  const [small, setSmall] = useState<boolean | null>(null);
  const [opening, setOpening] = useState('');
  // Walkthrough 18 Nov: switching "prices include VAT" on silently turned a typed 100.00 into 87.72 + 12.28 VAT. It now asks first.
  const [confirmInclusive, setConfirmInclusive] = useState(false);

  if (vat.error || !vat.data) return null; // an older API without the route: nothing to show
  const v = vat.data;
  const current = v.rates.find((r) => r.id === v.defaultVatRateId);
  const fromValue = from ?? v.vatFrom ?? '';
  const midMonth = fromValue !== '' && !fromValue.endsWith('-01');

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
      vat.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const setVat = (registered: boolean, defaultRateId: string | null, vatFrom?: string) =>
    run(async () => {
      const saved = await api<{ vatFromMidMonth?: boolean }>('/v1/core/org/vat', {
        method: 'PUT',
        body: JSON.stringify({ registered, defaultRateId, ...(vatFrom ? { vatFrom } : {}) }),
      });
      setFrom(null);
      return saved.vatFromMidMonth ? tr('Saved. VAT starts in the middle of a tax month: that month\'s return will be part with VAT and part without.') : null;
    });

  const saveRate = (f: RateForm) =>
    run(async () => {
      const body = JSON.stringify({ subType: f.subType, rate: Number(f.rate), label: f.label, isDefault: f.isDefault });
      if (f.id) await api(`/v1/core/org/vat/rates/${f.id}`, { method: 'PUT', body });
      else await api('/v1/core/org/vat/rates', { method: 'POST', body });
      setForm(null);
      return tr('Rate saved. Documents already issued keep their own rate.');
    });

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
                : v.rates.length === 0
                  ? tr('Add your VAT rate below first.')
                  : tr('Off: invoices carry no VAT.')}
            </p>
          </div>
          <label className="option-switch">
            <input
              type="checkbox"
              role="switch"
              aria-checked={v.vatRegistered}
              checked={v.vatRegistered}
              disabled={busy || !isOwner || (!v.vatRegistered && v.rates.length === 0)}
              aria-label={tr('VAT registered')}
              onChange={() => setVat(!v.vatRegistered, v.defaultVatRateId, v.vatRegistered ? undefined : fromValue || undefined)}
            />
            <span>{v.vatRegistered ? tr('On') : tr('Off')}</span>
          </label>
        </li>
      </ul>
      {!isOwner ? <p className="muted small">{tr('Only an owner can switch VAT on or off and choose the default rate.')}</p> : null}
      {isOwner && v.vatRegistered ? (
        <ul className="option-list">
          <li className="option-row">
            <div>
              <strong>{tr('Sales prices include VAT')}</strong>
              <p className="muted small">
                {tr('Leave this off unless you run a shop or online store that shows prices with VAT. Off (the usual way, and how e-invoices work): a price of 100.00 means 100.00 + 14.00 VAT = 114.00. On: 100.00 already includes the VAT, so it becomes 87.72 + 12.28 VAT = 100.00. New invoices only.')}
              </p>
              {confirmInclusive ? (
                <div className="notice stack" role="alert">
                  <p>{tr('Every sales price typed from now on will be read as already including VAT. Are you sure?')}</p>
                  <div className="form-actions">
                    <Button variant="destructive" size="sm" disabled={busy}
                      onClick={() => run(async () => {
                        await api('/v1/core/org/vat/prices-include', { method: 'PUT', body: JSON.stringify({ on: true }) });
                        setConfirmInclusive(false);
                        return null;
                      })}>
                      {tr('Yes, prices include VAT')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmInclusive(false)}>{tr('Cancel')}</Button>
                  </div>
                </div>
              ) : null}
            </div>
            <label className="option-switch">
              <input
                type="checkbox"
                role="switch"
                aria-checked={v.pricesIncludeVat === true}
                checked={v.pricesIncludeVat === true}
                disabled={busy}
                aria-label={tr('Sales prices include VAT')}
                onChange={() =>
                  // switching on asks first (above); switching off is the safe direction and happens at once
                  v.pricesIncludeVat === true
                    ? run(async () => {
                        await api('/v1/core/org/vat/prices-include', { method: 'PUT', body: JSON.stringify({ on: false }) });
                        return null;
                      })
                    : setConfirmInclusive(true)
                }
              />
              <span>{v.pricesIncludeVat ? tr('On') : tr('Off')}</span>
            </label>
          </li>
        </ul>
      ) : null}

      {isOwner && v.rates.length > 0 ? (
        <div className="form-row">
          {v.vatRegistered ? (
            <label>
              {tr('Default VAT rate')}
              <select value={v.defaultVatRateId ?? ''} disabled={busy} onChange={(e) => setVat(true, e.target.value || null)}>
                {v.rates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} ({r.rate}%)
                  </option>
                ))}
              </select>
              <span className="hint muted">{tr('Used on a line when its item has no VAT rate of its own.')}</span>
            </label>
          ) : null}
          <label>
            {tr('VAT applies from')}
            <DateInput value={fromValue} disabled={busy} onChange={(e) => setFrom(e.target.value)} />
            <span className="hint muted">{tr('Normally the first day of a tax month. Empty: the first day of this month.')}</span>
          </label>
          {v.vatRegistered && from !== null && from !== (v.vatFrom ?? '') ? (
            <Button variant="outline" disabled={busy || !from} onClick={() => setVat(true, v.defaultVatRateId, from)}>
              {tr('Save the start date')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {midMonth ? <p className="error small">{tr('This date is not the first day of a month: that month\'s return would be part with VAT and part without.')}</p> : null}

      <h3>{tr('VAT rates')}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{tr('Name')}</th>
              <th scope="col">{tr('ETA code')}</th>
              <th scope="col" className="right">{tr('Rate')}</th>
              <th scope="col">{tr('Default')}</th>
              <th scope="col">{tr('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {v.rates.map((r) => (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td>
                  <code>{r.subType}</code>
                </td>
                <td className="right">{r.rate}%</td>
                <td>{r.isDefault ? <span className="badge">{tr('Default rate')}</span> : ''}</td>
                <td>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setForm({ id: r.id, subType: r.subType, rate: String(r.rate), label: r.label, isDefault: r.isDefault })}>
                    {tr('Edit')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(async () => { await api(`/v1/core/org/vat/rates/${r.id}`, { method: 'DELETE' }); return tr('Rate removed.'); })}>
                    {tr('Remove')}
                  </Button>
                </td>
              </tr>
            ))}
            {v.rates.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted empty">
                  {tr('No VAT rates yet. Egypt\'s general rate is 14% (code V009); exports are 0% (V001); exempt sales use V003.')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {form ? (
        <div className="stack">
          <div className="form-row">
            <label>
              {tr('Name')}
              <input value={form.label} maxLength={100} placeholder={tr('e.g. VAT 14%')} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </label>
            <label>
              {tr('ETA code')}
              <select value={form.subType} onChange={(e) => setForm({ ...form, subType: e.target.value })}>
                {(v.subTypes ?? [{ code: 'V009', description: 'General item sales' }]).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} · {s.description}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr('Rate (%)')}
              <input inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              {tr('Default rate for new items and invoice lines')}
            </label>
            <p className="muted small">{tr('An item with no VAT rate of its own, and any line typed by hand, uses the default rate. Only one rate can be the default.')}</p>
          </div>
          <div className="form-actions">
            <Button disabled={busy || !form.label.trim() || !Number.isFinite(Number(form.rate)) || form.rate.trim() === ''} onClick={() => saveRate(form)}>
              {busy ? tr('Saving…') : tr('Save rate')}
            </Button>
            <Button variant="ghost" onClick={() => setForm(null)}>
              {tr('Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" disabled={busy} onClick={() => setForm(emptyRate)}>
          {tr('Add a VAT rate')}
        </Button>
      )}

      {isOwner ? (
        <>
          <h3>{tr('VAT return')}</h3>
          <div className="form-row">
            <label>
              {tr('Return due (days after the month ends)')}
              <input inputMode="numeric" value={dueDays ?? (v.returnDueDays === null || v.returnDueDays === undefined ? '' : String(v.returnDueDays))} placeholder={tr('End of the following month')} onChange={(e) => setDueDays(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={small ?? v.smallEnterprise === true} onChange={(e) => setSmall(e.target.checked)} />
              {tr('Small enterprise (Law 6/2025): refunds after more than 3 months')}
            </label>
            <Button
              variant="outline"
              disabled={busy || (dueDays === null && small === null)}
              onClick={() =>
                run(async () => {
                  const d = (dueDays ?? (v.returnDueDays == null ? '' : String(v.returnDueDays))).trim();
                  await api('/v1/core/org/vat/return', { method: 'PUT', body: JSON.stringify({ dueDays: d === '' ? null : Number(d), smallEnterprise: small ?? v.smallEnterprise === true }) });
                  setDueDays(null);
                  setSmall(null);
                  return tr('Saved.');
                })
              }
            >
              {tr('Save')}
            </Button>
          </div>
          {session.modules.includes('accounting') && v.vatRegistered && !v.openingEntered ? (
            <div className="form-row">
              <label>
                {tr('Opening VAT balance at the start date')}
                <input inputMode="decimal" value={opening} placeholder="0.00" onChange={(e) => setOpening(e.target.value)} />
                <span className="hint muted">{tr('Only if the company already filed VAT returns: a credit brought forward is positive, VAT still owed is negative.')}</span>
              </label>
              <Button
                variant="outline"
                disabled={busy || !opening.trim() || !Number(opening)}
                onClick={() =>
                  run(async () => {
                    await api('/v1/accounting/vat-opening', { method: 'POST', body: JSON.stringify({ amountMinor: Math.round(Number(opening) * 100), post: true }) });
                    setOpening('');
                    return tr('Opening VAT balance entered.');
                  })
                }
              >
                {tr('Enter the opening balance')}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

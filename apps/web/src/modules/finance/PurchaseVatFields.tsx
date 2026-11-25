import type { VatSettings } from '@erp/shared';
import { RegistryField, TextField, fieldOk } from '../../components/Fields';
import { tr } from '../../lib/i18n';
import { toMinor } from '../trade/common';

// VAT on a purchase (supplier bill or expense; sql/087, VAT plan part 2). The VAT is entered as printed on the supplier's document.
// The kind of purchase is chosen per line on a bill, once on an expense (sql/088). For a bill the VAT may be left empty (the VAT worked out from the line rates is used); the database refuses a figure too far from that.
// "Deduct this VAT" needs the company to be VAT registered and the supplier's e-invoice number (or, for an import, the customs
// declaration); non-deductible VAT becomes part of the cost.

export type PurchaseVat = { tax: string; ref: string; vatClass: 'local' | 'capital' | 'import'; noDeduct: boolean; rateId: string; taxNumber: string };
export const emptyPurchaseVat: PurchaseVat = { tax: '', ref: '', vatClass: 'local', noDeduct: false, rateId: '', taxNumber: '' };

/** The `vat` object for the API, or undefined when nothing was entered (the server then uses its defaults). */
export function purchaseVatPayload(v: PurchaseVat): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (v.tax.trim() !== '') out.taxMinor = toMinor(v.tax);
  if (v.rateId) out.taxRateId = v.rateId;
  if (v.ref.trim()) out.documentRef = v.ref.trim();
  if (v.taxNumber.trim()) out.supplierTaxNumber = v.taxNumber.trim();
  if (v.vatClass !== 'local') out.vatClass = v.vatClass;
  if (v.noDeduct) out.deductible = false;
  return Object.keys(out).length ? out : undefined;
}

/** False while a box here cannot be saved (the supplier's tax number is digits only): the form keeps Save off. */
export const purchaseVatOk = (v: PurchaseVat): boolean => fieldOk.registry(v.taxNumber);

export function PurchaseVatFields({
  value,
  onChange,
  vat,
  kind,
}: {
  value: PurchaseVat;
  onChange: (v: PurchaseVat) => void;
  vat: VatSettings | null | undefined;
  kind: 'bill' | 'expense';
}) {
  const set = (patch: Partial<PurchaseVat>) => onChange({ ...value, ...patch });
  const registered = vat?.vatRegistered === true;
  const deducts = registered && !value.noDeduct && value.ref.trim() !== '' && (kind === 'bill' || value.tax.trim() !== '');
  return (
    <fieldset className="stack">
      <legend>{tr('VAT on this purchase')}</legend>
      <div className="form-row">
        <label>
          {tr('VAT on the supplier\'s invoice')}
          <input inputMode="decimal" value={value.tax} placeholder={kind === 'bill' ? tr('Worked out from the lines') : '0'} onChange={(e) => set({ tax: e.target.value })} />
        </label>
        {kind === 'expense' && vat?.rates.length ? (
          <label>
            {tr('VAT rate (to check the amount)')}
            <select value={value.rateId} onChange={(e) => set({ rateId: e.target.value })}>
              <option value="">{tr('No check')}</option>
              {vat.rates.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.rate}%)
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === 'expense' ? (
        <label>
          {tr('Kind of purchase')}
          <select value={value.vatClass} onChange={(e) => set({ vatClass: e.target.value as PurchaseVat['vatClass'] })}>
            <option value="local">{tr('Goods and services')}</option>
            <option value="capital">{tr('Capital asset (equipment, machinery)')}</option>
            <option value="import">{tr('Import (customs)')}</option>
          </select>
        </label>
        ) : null}
      </div>
      <div className="form-row">
        <TextField
          label={value.vatClass === 'import' ? tr('Customs declaration number') : tr('Supplier\'s e-invoice number')}
          max={100}
          value={value.ref}
          onChange={(v) => set({ ref: v })}
        />
        {kind === 'expense' ? (
          <RegistryField label={tr('Supplier\'s tax number (optional)')} max={50} value={value.taxNumber} onChange={(v) => set({ taxNumber: v })} />
        ) : null}
        {registered ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!value.noDeduct} onChange={(e) => set({ noDeduct: !e.target.checked })} />
            {tr('Deduct this VAT')}
          </label>
        ) : null}
      </div>
      <p className="muted small">
        {!registered
          ? tr('Your company is not VAT registered: VAT paid on purchases is part of the cost.')
          : deducts
            ? tr('This VAT will be deducted from the VAT you owe.')
            : tr('This VAT will not be deducted: it is added to the cost. A deduction needs the supplier\'s e-invoice number and 9-digit tax number.')}
      </p>
    </fieldset>
  );
}

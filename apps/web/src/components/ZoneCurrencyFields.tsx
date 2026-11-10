import { useId, useMemo } from 'react';
import { tr } from '../lib/i18n';
import { currencyChoices, timeZoneList } from '../lib/zonesCurrencies';

/** Currency as a dropdown of ISO 4217 codes with their names. */
export function CurrencySelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <select required value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {currencyChoices(value).map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} - {tr(c.name)}
        </option>
      ))}
    </select>
  );
}

/** Searchable time zone picker: type to filter the list of IANA zones; only a zone from the list is accepted. */
export function TimeZoneSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  const zones = useMemo(() => timeZoneList(), []);
  return (
    <>
      <input
        required
        list={id}
        value={value}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        dir="ltr"
        placeholder={tr('Type to search, e.g. Africa/Cairo')}
        onChange={(e) => {
          onChange(e.target.value);
          e.target.setCustomValidity(zones.includes(e.target.value) ? '' : tr('Pick a time zone from the list.'));
        }}
        ref={(el) => el?.setCustomValidity(zones.includes(value) ? '' : tr('Pick a time zone from the list.'))}
      />
      <datalist id={id}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

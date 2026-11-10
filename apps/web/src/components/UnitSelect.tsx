import { useState } from 'react';
import { tr } from '../lib/i18n';
import { COMMON_UNITS, isCommonUnit } from '../lib/units';

const OTHER = '__other__';

/**
 * The unit of an item as a dropdown of common units, with "Other…" for a free text (walkthrough fix, 10 Nov 2026: "unit should be dropdown").
 * The value is the unit's English word (what is stored); the labels are translated.
 */
export function UnitSelect({ value, onChange, label, className }: { value: string; onChange: (unit: string) => void; label: string; className?: string }) {
  const [other, setOther] = useState(() => value.trim() !== '' && !isCommonUnit(value));
  const showText = other || (value.trim() !== '' && !isCommonUnit(value));
  return (
    <span className="flex items-center gap-1">
      <select
        className={className}
        aria-label={label}
        value={showText ? OTHER : value || 'piece'}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOther(true);
            onChange('');
          } else {
            setOther(false);
            onChange(e.target.value);
          }
        }}
      >
        {COMMON_UNITS.map((u) => (
          <option key={u} value={u}>{tr(u)}</option>
        ))}
        <option value={OTHER}>{tr('Other…')}</option>
      </select>
      {showText ? (
        <input
          className={className}
          aria-label={`${label}: ${tr('Other…')}`}
          maxLength={32}
          autoFocus={value === ''}
          placeholder={tr('Type the unit')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </span>
  );
}

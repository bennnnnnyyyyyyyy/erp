import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { tr } from '../lib/i18n';

// A long list you can type in (decision, 9 Nov 2026): replaces plain dropdowns of customers, suppliers, items and accounts, which meant
// scrolling through hundreds of rows. Matches every typed word, in any order, against the label and any extra words (code, phone, SKU),
// in Arabic or English. Keyboard: arrows move, Enter picks, Escape closes. The chosen value is held by the parent, like a <select>.

export type SearchOption = { value: string; label: string; /** Extra words that should also match (code, phone, SKU). */ keywords?: string };

/** Lower-case and without Arabic diacritics or tatweel, so "أحمد" also matches "احمد". */
export const normalizeSearch = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

export function matchesSearch(option: SearchOption, query: string): boolean {
  const hay = normalizeSearch(`${option.label} ${option.keywords ?? ''}`);
  return normalizeSearch(query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const MAX_SHOWN = 50;

export function SearchSelect({
  options, value, onChange, placeholder, label, required, emptyLabel,
}: {
  options: SearchOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name when there is no visible <label> around it. */
  label?: string;
  required?: boolean;
  /** When set, an option to clear the choice (for optional fields). */
  emptyLabel?: string;
}) {
  const id = useId();
  const chosen = options.find((o) => o.value === value);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<number | null>(null);

  const shown = useMemo(() => {
    const list = query.trim() ? options.filter((o) => matchesSearch(o, query)) : options;
    return list.slice(0, MAX_SHOWN);
  }, [options, query]);
  const rows = emptyLabel ? [{ value: '', label: emptyLabel }, ...shown] : shown;

  const pick = (v: string) => {
    onChange(v);
    setQuery('');
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); const r = rows[active]; if (r) pick(r.value); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  return (
    <span className="search-select">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-label={label}
        aria-activedescendant={open && rows[active] ? `${id}-${active}` : undefined}
        // A hidden required check: the visible text box may show a label while the value is the id.
        required={required && !value}
        placeholder={chosen ? chosen.label : (placeholder ?? tr('Type to search…'))}
        value={open ? query : (chosen?.label ?? '')}
        onFocus={() => { setOpen(true); setActive(0); }}
        onBlur={() => { blurTimer.current = window.setTimeout(() => { setOpen(false); setQuery(''); }, 120); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKey}
        autoComplete="off"
      />
      {open ? (
        <ul id={`${id}-list`} role="listbox" className="search-select-list">
          {rows.length === 0 ? <li className="muted small search-select-none">{tr('Nothing matches.')}</li> : null}
          {rows.map((o, i) => (
            <li
              key={o.value || '__empty'}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => { e.preventDefault(); if (blurTimer.current) window.clearTimeout(blurTimer.current); pick(o.value); }}
              onMouseEnter={() => setActive(i)}
            >
              {o.label}
            </li>
          ))}
          {!query.trim() && options.length > MAX_SHOWN ? <li className="muted small search-select-none">{tr('Type to see more.')}</li> : null}
        </ul>
      ) : null}
    </span>
  );
}

import { useContext, useEffect, useRef, useState } from 'react';
import { dayPattern, readDay, showDay } from '../lib/dates';
import { tr, trf } from '../lib/i18n';
import { SessionContext } from '../session';

// A date box that follows the company's Date format setting (UX audit 20 Nov 2026: the browser's own date box showed 11/20/2026 on
// an English computer while the company uses 20/11/2026). The person types in the company format, or picks from the browser's
// calendar with the button; the value given and received stays YYYY-MM-DD, like the browser's date box.
// It takes the same props as <input type="date"> so a screen only swaps the tag: onChange receives { target: { value } }.

type Props = {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
};

export function DateInput({ value, onChange, min, max, required, disabled, className, 'aria-label': ariaLabel }: Props) {
  const format = useContext(SessionContext)?.session.org?.dateFormat ?? 'DD/MM/YYYY';
  const [text, setText] = useState(() => showDay(value, format));
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // A new value from outside (a reset, a preset, the calendar) replaces what is typed.
  useEffect(() => {
    if (readDay(text, format) !== value) {
      setText(showDay(value, format));
      setBad(false);
    }
    // Only when the value or the format changes; `text` follows the person's typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, format]);

  function typed(next: string) {
    setText(next);
    const day = readDay(next, format);
    const outOfRange = day && ((min && day < min) || (max && day > max));
    setBad(day === null || !!outOfRange);
    if (day !== null && !outOfRange && day !== value) onChange({ target: { value: day } });
  }

  function openCalendar() {
    const el = picker.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  }

  return (
    <span className={`date-input${className ? ` ${className}` : ''}`}>
      <input
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={text}
        placeholder={dayPattern(format)}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        title={bad ? trf('Type a date like {pattern}', { pattern: dayPattern(format) }) : undefined}
        onChange={(e) => typed(e.target.value)}
        onBlur={() => !bad && setText(showDay(value, format))}
      />
      <button type="button" className="date-input-pick" onClick={openCalendar} disabled={disabled} aria-label={tr('Pick a date')} title={tr('Pick a date')}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      <input
        ref={picker}
        type="date"
        className="date-input-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange({ target: { value: e.target.value } })}
      />
    </span>
  );
}

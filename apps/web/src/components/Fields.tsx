import { type ReactNode, useId, useState } from 'react';
import {
  FIELD_MAX,
  bankAccountCharsOnly,
  bankAccountOk,
  checkPhone,
  egMobileOk,
  emailOk,
  phoneCharsOnly,
  phoneState,
  registryCharsOnly,
  registryOk,
} from '@erp/shared';
import { tr, trf } from '../lib/i18n';

// Boxes that guide the person while they type (Ben, 25 Nov 2026: "checking only when Save is pressed is not enough"). Each box takes
// at most its limit, drops characters it can never hold, shows a counter near its limit and a red line as soon as the value cannot
// be valid. The form keeps Save off while one of them is not valid (`fieldOk`). The rules are shared with the API and the database
// (packages/shared/src/fieldRules.ts, phone.ts).

export const PHONE_HELP =
  'An Egyptian mobile is 11 digits: 01x xxxx xxxx. A landline is its area code and number. A number in another country starts with + and its country code.';
export const MOBILE_HELP = 'An Egyptian mobile is 11 digits: 01x xxxx xxxx.';
export const EMAIL_HELP = 'An email address looks like name@company.com.';
export const REGISTRY_HELP = 'Digits only (spaces or dashes between groups are fine).';
export const BANK_HELP = 'An account number is digits; an IBAN starts with the country letters (an Egyptian IBAN is 29 characters).';

/** Is this value acceptable to save? The same rules as the boxes below. */
export const fieldOk = {
  phone: (v: string) => checkPhone(v).ok,
  mobile: (v: string) => !v.trim() || egMobileOk(v),
  email: (v: string) => !v.trim() || emailOk(v),
  registry: (v: string) => registryOk(v),
  bankAccount: (v: string) => bankAccountOk(v),
};

type Base = {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
};

function Count({ length, max }: { length: number; max: number }) {
  if (length < Math.floor(max * 0.8)) return null;
  return (
    <span className={length >= max ? 'field-count full' : 'field-count'} aria-live="polite">
      {length}/{max}
    </span>
  );
}

function Problem({ id, show, text }: { id: string; show: boolean; text: string }) {
  return show ? (
    <span id={id} className="field-error" role="alert">
      {text}
    </span>
  ) : null;
}

/** A text box (or a text area) with its limit and a counter near it. */
export function TextField({
  label,
  value,
  onChange,
  max,
  multiline,
  rows,
  dir,
  ...rest
}: Base & { max: number; multiline?: boolean; rows?: number; dir?: 'ltr' | 'rtl' | 'auto' }) {
  const common = { value, maxLength: max, dir, onChange: (e: { target: { value: string } }) => onChange(e.target.value.slice(0, max)), ...rest };
  return (
    <label>
      {label}
      {multiline ? <textarea rows={rows ?? 3} {...common} /> : <input {...common} />}
      <Count length={value.length} max={max} />
    </label>
  );
}

/** A phone box: only phone characters, at most 20; red at once when the number can no longer be valid, and on leaving the box when
 * it is not finished. `mobileOnly`: an Egyptian mobile (shipments). */
export function PhoneField({ label, value, onChange, mobileOnly, ...rest }: Base & { mobileOnly?: boolean }) {
  const id = useId();
  const [left, setLeft] = useState(false);
  const state = phoneState(value);
  const bad =
    state === 'invalid' ||
    (left && state === 'incomplete') ||
    (mobileOnly && state === 'ok' && !egMobileOk(value)) ||
    (mobileOnly && left && state !== 'empty' && !egMobileOk(value));
  return (
    <label>
      {label}
      <input
        {...rest}
        type="tel"
        inputMode="tel"
        dir="ltr"
        autoComplete="tel"
        maxLength={FIELD_MAX.phone}
        value={value}
        placeholder={rest.placeholder ?? '01x xxxx xxxx'}
        aria-invalid={bad}
        aria-describedby={bad ? id : undefined}
        onChange={(e) => onChange(phoneCharsOnly(e.target.value).slice(0, FIELD_MAX.phone))}
        onBlur={() => setLeft(true)}
      />
      <Problem id={id} show={!!bad} text={tr(mobileOnly ? MOBILE_HELP : PHONE_HELP)} />
    </label>
  );
}

/** An email box: red as soon as it holds a space or comma, and on leaving the box when it is not an address. */
export function EmailField({ label, value, onChange, max = FIELD_MAX.email, ...rest }: Base & { max?: number }) {
  const id = useId();
  const [left, setLeft] = useState(false);
  const v = value.trim();
  const bad = v !== '' && !emailOk(v) && (left || /[\s,;<>]/.test(v) || (v.match(/@/g) ?? []).length > 1);
  return (
    <label>
      {label}
      <input
        {...rest}
        type="email"
        inputMode="email"
        dir="ltr"
        autoComplete="email"
        maxLength={max}
        value={value}
        aria-invalid={bad}
        aria-describedby={bad ? id : undefined}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        onBlur={() => setLeft(true)}
      />
      <Problem id={id} show={bad} text={tr(EMAIL_HELP)} />
      <Count length={value.length} max={max} />
    </label>
  );
}

/** A tax registration or commercial registry number: digits (spaces or dashes between groups). `exact`: a fixed number of digits
 * (for example 9 for an ETA registration number), red on leaving the box when it is not that long. */
export function RegistryField({ label, value, onChange, max = FIELD_MAX.taxNumber, exact, ...rest }: Base & { max?: number; exact?: number }) {
  const id = useId();
  const [left, setLeft] = useState(false);
  const digits = value.replace(/[^0-9٠-٩۰-۹]/g, '').length;
  const wrongLength = exact !== undefined && value.trim() !== '' && digits !== exact;
  const bad = !registryOk(value) || (left && wrongLength) || (exact !== undefined && digits > exact);
  return (
    <label>
      {label}
      <input
        {...rest}
        inputMode="numeric"
        dir="ltr"
        maxLength={exact !== undefined ? exact + 4 : max}
        value={value}
        aria-invalid={bad}
        aria-describedby={bad ? id : undefined}
        onChange={(e) => onChange(registryCharsOnly(e.target.value).slice(0, exact !== undefined ? exact + 4 : max))}
        onBlur={() => setLeft(true)}
      />
      <Problem id={id} show={bad} text={exact !== undefined ? trf('Exactly {n} digits.', { n: exact }) : tr(REGISTRY_HELP)} />
    </label>
  );
}

/** A bank account number or IBAN. */
export function BankAccountField({ label, value, onChange, ...rest }: Base) {
  const id = useId();
  const [left, setLeft] = useState(false);
  const bad = left && !bankAccountOk(value);
  return (
    <label>
      {label}
      <input
        {...rest}
        dir="ltr"
        maxLength={FIELD_MAX.bankAccount}
        value={value}
        aria-invalid={bad}
        aria-describedby={bad ? id : undefined}
        onChange={(e) => onChange(bankAccountCharsOnly(e.target.value).toUpperCase().slice(0, FIELD_MAX.bankAccount))}
        onBlur={() => setLeft(true)}
      />
      <Problem id={id} show={bad} text={tr(BANK_HELP)} />
    </label>
  );
}

// Field rules shared by the screens (checked while the person types), the API and the sample build (Ben, 25 Nov 2026: "checking
// only when Save is pressed is not enough"). The database repeats the lengths and the phone rule (sql/019, 076, 081, 114) and the
// email rule (sql/116).
import { checkPhone } from './phone';

/** The longest text each kind of box takes (the same limits as the API and the database). */
export const FIELD_MAX = {
  name: 200,
  contact: 120,
  city: 80,
  phone: 20,
  email: 200,
  address: 500,
  notes: 500,
  longNotes: 2000,
  taxNumber: 40,
  commercialRegistry: 40,
  bankName: 120,
  bankAccount: 60,
} as const;

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const western = (s: string) => s.replace(ARABIC_DIGITS, (ch) => String((ch.charCodeAt(0) & 0xf) % 10));

/** Only what a phone number may contain: digits (Western and Arabic), +, spaces, dashes, dots and brackets. */
export const phoneCharsOnly = (s: string): string => s.replace(/[^0-9٠-٩۰-۹+\s().-]/g, '');

/**
 * Where a phone number stands while it is typed: `empty`, `ok`, `incomplete` (it can still become a valid number) or `invalid` (it
 * can no longer become one: too many digits, a wrong start). The final rule is `checkPhone`.
 */
export function phoneState(input: string): 'empty' | 'ok' | 'incomplete' | 'invalid' {
  const compact = western(input)
    .trim()
    .replace(/[\s().-]/g, '');
  if (!compact) return 'empty';
  if (!/^(\+|00)?\d*$/.test(compact) || (compact.includes('+') && !compact.startsWith('+'))) return 'invalid';
  if (checkPhone(input).ok) return 'ok';
  let eg: string;
  if (compact.startsWith('+') || compact.startsWith('00')) {
    const n = compact.startsWith('+') ? compact.slice(1) : compact.slice(2);
    if (n.length < 2) return '20'.startsWith(n) || /^[1-9]?$/.test(n) ? 'incomplete' : 'invalid';
    if (!n.startsWith('20')) return n.startsWith('0') || n.length > 15 ? 'invalid' : 'incomplete';
    eg = n.slice(2);
  } else {
    eg = compact.startsWith('0') ? compact.slice(1) : compact;
  }
  // Egyptian: at most 10 digits after the 0 (a mobile 1x + 8; Cairo 2 + 8; others fewer); never another 0; a mobile is 10, 11, 12 or 15
  if (eg.length > 10 || eg.startsWith('0')) return 'invalid';
  if (eg.startsWith('1') && eg.length >= 2 && !'0125'.includes(eg[1] as string)) return 'invalid';
  if (eg.startsWith('1') && eg.length > 10) return 'invalid';
  return 'incomplete';
}

/** An Egyptian mobile (shipments): 01[0125] + 8 digits, with or without +20 / 0020 (the database's core__eg_mobile_ok, sql/114). */
export const egMobileOk = (v: string): boolean => /^(\+20|0020|0)?1[0125]\d{8}$/.test(western(v).replace(/[\s().-]/g, ''));

/** An email address: something@domain.tld, no spaces, at most 200 characters (the tester's "lskalmsalsasm.,ma" is refused). */
export function emailOk(v: string): boolean {
  const s = v.trim();
  return (
    s.length <= FIELD_MAX.email &&
    /^[^\s@,;<>()"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/.test(s)
  );
}

/** The plain rules, as the API and the screens say them (Arabic in the web app's tables). */
export const REGISTRY_RULE = 'digits only (spaces or dashes between groups are fine)';
export const BANK_RULE = 'an account number is digits; an IBAN starts with the country letters (an Egyptian IBAN is 29 characters)';

/** A tax registration or commercial registry number: digits (Western or Arabic), with spaces or dashes between groups. */
// Arabic digits become Western digits as they are typed (the ETA numbers are checked as Western digits by the API).
export const registryCharsOnly = (s: string): string => western(s).replace(/[^0-9\s-]/g, '');
export const registryOk = (v: string): boolean => !v.trim() || /^[0-9]+([\s-][0-9]+)*$/.test(western(v.trim()));

/** A bank account number or IBAN: letters, digits and spaces. An IBAN (two letters first) has its shape; an Egyptian one is 29. */
export const bankAccountCharsOnly = (s: string): string => s.replace(/[^A-Za-z0-9٠-٩۰-۹\s-]/g, '');
export function bankAccountOk(v: string): boolean {
  const s = western(v).replace(/[\s-]/g, '').toUpperCase();
  if (!s) return true;
  if (/^[A-Z]{2}/.test(s)) return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s) && (!s.startsWith('EG') || s.length === 29);
  return /^\d{4,34}$/.test(s);
}

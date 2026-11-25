// Phone numbers as people type them (Ben's live test, 25 Nov 2026: "+2015556487744", +20 and 11 digits, was accepted by the old
// "7 to 15 digits" rule). One rule for the API, the screens and the sample build; the database repeats it (sql/114).
// - Spaces, dashes, dots, brackets and Arabic digits are fine.
// - Egypt (+20, 0020, or a leading 0): a mobile is 1 + (0, 1, 2 or 5) + 8 digits (010 1234 5678); a landline is Cairo or Giza 2 + 8
//   digits, Alexandria 3 + 7 digits, or another area code (2 digits) + 7 digits.
// - Any other country: + (or 00) and the country code, 8 to 15 digits in all (E.164).

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toWesternDigits = (s: string) => s.replace(ARABIC_DIGITS, (ch) => String((ch.charCodeAt(0) & 0xf) % 10));

/** Egyptian area codes other than Cairo/Giza (2) and Alexandria (3), without the leading 0. */
const EG_AREAS = [
  '40',
  '45',
  '46',
  '47',
  '48',
  '50',
  '55',
  '57',
  '62',
  '64',
  '65',
  '66',
  '68',
  '69',
  '82',
  '84',
  '86',
  '88',
  '92',
  '93',
  '95',
  '96',
  '97',
];

/** Is this an Egyptian number written without the country code and without the leading 0? */
export function isEgyptianNational(n: string): boolean {
  if (/^1[0125]\d{8}$/.test(n)) return true; // mobile
  if (/^2\d{8}$/.test(n)) return true; // Cairo, Giza
  if (/^3\d{7}$/.test(n)) return true; // Alexandria
  return EG_AREAS.includes(n.slice(0, 2)) && /^\d{9}$/.test(n);
}

export const PHONE_RULE_MESSAGE =
  'an Egyptian number is 01x xxxx xxxx for a mobile, or the area code and number for a landline; a number in another country starts with + and its country code';

/**
 * Checks a typed phone number. Returns `{ ok: true, value }` with the text as typed (trimmed, Western digits), `{ ok: true, value: null }`
 * when empty, or `{ ok: false }` when it is not a phone number by the rule above.
 */
export function checkPhone(input: unknown): { ok: true; value: string | null } | { ok: false } {
  const raw = typeof input === 'string' ? toWesternDigits(input).trim() : typeof input === 'number' ? String(input) : '';
  if (!raw) return { ok: true, value: null };
  const compact = raw.replace(/[\s\-().]/g, '');
  if (!/^(\+|00)?\d+$/.test(compact)) return { ok: false };
  let international: string | null = null;
  if (compact.startsWith('+')) international = compact.slice(1);
  else if (compact.startsWith('00')) international = compact.slice(2);
  if (international !== null) {
    if (international.startsWith('20')) return isEgyptianNational(international.slice(2)) ? { ok: true, value: raw } : { ok: false };
    return /^[1-9]\d{7,14}$/.test(international) ? { ok: true, value: raw } : { ok: false };
  }
  // No country code: an Egyptian number, with its leading 0 (010…, 02…) or without it.
  const national = compact.startsWith('0') ? compact.slice(1) : compact;
  return isEgyptianNational(national) ? { ok: true, value: raw } : { ok: false };
}

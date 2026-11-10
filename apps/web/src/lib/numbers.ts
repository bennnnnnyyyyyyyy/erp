// Reading numbers the way people type them (UX audit 9 Nov 2026): "1,500", "1500.75", Arabic digits "١٥٠٠" or "١٬٥٠٠٫٥".
// A browser number field empties itself on any of these, so amount fields are text fields read through here.

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** The typed text as a number, or NaN when it is not one. Blank is NaN too, so callers can tell "nothing typed" from zero. */
export function parseAmount(text: string): number {
  let s = '';
  for (const ch of text.trim()) {
    const a = ARABIC_INDIC.indexOf(ch);
    const p = PERSIAN.indexOf(ch);
    if (a >= 0) s += String(a);
    else if (p >= 0) s += String(p);
    else if (ch === '٫') s += '.';   // Arabic decimal separator
    else if (ch === ',' || ch === '٬' || ch === ' ' || ch === ' ') continue;   // thousands separators
    else s += ch;
  }
  if (!/^-?\d+(\.\d+)?$/.test(s) && !/^-?\.\d+$/.test(s)) return Number.NaN;
  return Number(s);
}

/** Money typed by a person, in minor units (18.50 -> 1850); 0 when blank or not a number. */
export const toMinor = (text: string) => {
  const n = parseAmount(text);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * A quantity as people read it: no trailing zeros ("1", not "1.000"; "2.5" stays "2.5"), thousands grouped. Quantities are stored with
 * three decimals so kilos and litres work, but a piece count must never show them. Accepts the text the database sends too ("1.000").
 */
export function formatQty(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '';
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return String(n);
  return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** True when something was typed that is not a number, so the form can say so instead of silently disabling its button. */
export const isBadAmount = (text: string) => text.trim() !== '' && !Number.isFinite(parseAmount(text));

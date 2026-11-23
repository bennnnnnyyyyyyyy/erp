import { formatMoney } from '@erp/shared';
import { formatQty } from './numbers';

// Audit-log summaries are written by database functions as plain English with raw numbers: money as minor units ("200000 minor units
// (175439 before VAT, 24561 VAT)") and quantities with the stored three decimals ("2.000 x test cream"). Old rows can not change
// (append-only), so the screens tidy the text when they show it (UX audit 20 Nov 2026). The raw text stays in the CSV export.

const MINOR = String.raw`(-?\d+) minor units`;

/** Money in a summary, from minor units, in the given currency (the record's, else the company's). */
function money(minor: string, currency: string): string {
  return formatMoney({ amountMinor: Number(minor), currency });
}

/**
 * The summary as people read it:
 * - "N minor units EGP" and "N minor units" become "EGP 2,000.00" (the currency written after the number wins over the fallback);
 * - "(A before VAT, B VAT" becomes money too when it follows minor units;
 * - "Cost of X set from A to B minor units" shows both amounts as money;
 * - "from N (minor units)" (a purchase approval limit) becomes money;
 * - quantities with three decimals ("2.000 x item", "available 27.806") lose the trailing zeros, and " x " becomes " × ".
 */
export function readableSummary(summary: string | null | undefined, currency: string): string {
  if (!summary) return '';
  let s = summary;
  s = s.replace(/from (-?\d+) \(minor units\)/g, (_m, a: string) => `from ${money(a, currency)}`);
  s = s.replace(new RegExp(String.raw`from (-?\d+) to ${MINOR}`, 'g'), (_m, a: string, b: string) => `from ${money(a, currency)} to ${money(b, currency)}`);
  s = s.replace(new RegExp(String.raw`${MINOR} \((-?\d+) before VAT, (-?\d+) VAT`, 'g'), (_m, g: string, n: string, t: string) =>
    `${money(g, currency)} (${money(n, currency)} before VAT, ${money(t, currency)} VAT`);
  s = s.replace(new RegExp(String.raw`${MINOR} ([A-Z]{3})\b`, 'g'), (_m, a: string, cur: string) => money(a, cur));
  s = s.replace(new RegExp(MINOR, 'g'), (_m, a: string) => money(a, currency));
  // Quantities: the database keeps three decimals; a piece count must read "2", not "2.000".
  s = s.replace(/(-?\d+\.\d{3})(?=\D|$)/g, (n: string) => formatQty(n));
  s = s.replace(/(\d) x /g, '$1 × ');
  return s;
}

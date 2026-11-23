import { type AuditEntry, formatMoney } from '@erp/shared';
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

/**
 * Rows that say the same thing at the same moment become one row with a count. A reminder or escalation is queued once for each
 * manager and the database writes one audit row for each, without the person's name: OUT-0376 showed "Reminder queued" twice at
 * 16:15 (UX audit, 20 Nov). It was two people, not a double send; the row now says "to 2 people".
 */
export function collapseSame(rows: AuditEntry[]): (AuditEntry & { times: number })[] {
  const out: (AuditEntry & { times: number })[] = [];
  for (const e of rows) {
    const last = out[out.length - 1];
    if (last && last.occurred_at === e.occurred_at && last.action === e.action && last.summary === e.summary && last.actor_user_id === e.actor_user_id) {
      last.times += 1;
    } else {
      out.push({ ...e, times: 1 });
    }
  }
  return out;
}

/**
 * A notification body as people read it (UX audit 20 Nov: "Overdue invoices: 72" was one huge paragraph of raw numbers). Alert
 * messages hold one line per item (at most ten, then "...and N more"; sql/086). The screens show the first line and how many more;
 * the title already gives the count, and the Open link goes to the list. Money written as "6717.31 EGP" becomes "EGP 6,717.31",
 * quantities lose the stored decimals, and dates (2026-11-02) follow the company format.
 */
export function readableMessage(body: string | null | undefined, showDate: (ymd: string) => string): { first: string; more: number } {
  const lines = (body ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  let more = Math.max(lines.length - 1, 0);
  const tail = /^\.\.\.and (\d+) more$/.exec(lines[lines.length - 1] ?? '');
  if (tail && lines.length > 1) more = lines.length - 2 + Number(tail[1]);
  let s = lines[0] ?? '';
  s = s.replace(/(-?\d+(?:\.\d+)?) ([A-Z]{3})\b/g, (_m, n: string, cur: string) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(Number(n));
    } catch {
      return `${n} ${cur}`;
    }
  });
  s = s.replace(/(-?\d+\.\d{3})(?=\D|$)/g, (n: string) => formatQty(n));
  s = s.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d: string) => showDate(d));
  return { first: s, more };
}

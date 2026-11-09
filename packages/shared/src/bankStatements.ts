// Bank statement import: reading a statement file and suggesting matches (documentation/plans/BANK_STATEMENT_IMPORT_PLAN.md §7).
// Pure functions, shared by the browser (reads the file, shows the preview) and the API (re-checks lines, suggests matches).
// Nothing here saves or posts anything: a person confirms every match.

// ------------------------------------------------------------------ reading CSV

/** Splits CSV text into rows of cells. Handles quoted cells (with commas, quotes and line breaks inside), CRLF, a UTF-8 BOM, and
 *  comma, semicolon or tab separators (detected from the first line when not given). Empty lines are dropped. */
export function parseCsv(text: string, separator?: ',' | ';' | '\t'): string[][] {
  const src = text.replace(/^﻿/, '');
  const sep = separator ?? detectSeparator(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function detectSeparator(text: string): ',' | ';' | '\t' {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => first.split(c).length - 1;
  const counts: [',' | ';' | '\t', number][] = [
    [',', count(',')],
    [';', count(';')],
    ['\t', count('\t')],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const best = counts[0];
  return best && best[1] > 0 ? best[0] : ',';
}

// ------------------------------------------------------------------ amounts and dates

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Western digits for Arabic-Indic and Persian ones, "." for the Arabic decimal separator, and no thousands separators. */
function westernNumber(text: string, decimal: '.' | ','): string {
  let s = '';
  for (const ch of text.trim()) {
    const a = ARABIC_INDIC.indexOf(ch);
    const p = PERSIAN.indexOf(ch);
    if (a >= 0) s += String(a);
    else if (p >= 0) s += String(p);
    else if (ch === '٫') s += '.';
    else if (ch === '٬' || ch === ' ' || ch === ' ' || ch === "'") continue;
    else if (ch === decimal) s += '.';
    else if (ch === ',' || ch === '.')
      continue; // the other one is the thousands separator
    else s += ch;
  }
  return s;
}

/** A statement amount in minor units, or null when it is not a number. Blank is null. Accepts "1,500.75", "1.500,75" (decimal ','),
 *  Arabic digits, "-12.50", "12.50-", "(12.50)" and a currency code or "EGP"/"ج.م" around the number. */
export function parseStatementAmount(text: string, opts: { decimal?: '.' | ','; minorDigits?: number } = {}): number | null {
  const decimal = opts.decimal ?? '.';
  const digits = opts.minorDigits ?? 2;
  let s = westernNumber(text, decimal)
    .replace(/[A-Za-z]{3}$|^[A-Za-z]{3}/, '')
    .replace(/ج\.?م\.?/g, '')
    .trim();
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  if (frac.length > digits && /[1-9]/.test(frac.slice(digits))) return null; // more precision than the currency has: refuse, never round money
  const minor = Number(whole || '0') * 10 ** digits + Number((frac + '0'.repeat(digits)).slice(0, digits) || '0');
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

export const STATEMENT_DATE_FORMATS = ['dd/mm/yyyy', 'mm/dd/yyyy', 'yyyy-mm-dd'] as const;
export type StatementDateFormat = (typeof STATEMENT_DATE_FORMATS)[number];

const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** A statement date as YYYY-MM-DD, or null. "dd/mm/yyyy" also accepts "-" and "." separators and two-digit years (20xx). A plain
 *  number between 20000 and 80000 is read as an Excel date serial (what .xlsx files store). Arabic digits are accepted. */
export function parseStatementDate(text: string, format: StatementDateFormat): string | null {
  const s = westernNumber(text.trim().replace(/\s.*$/, ''), '.'); // drop a time part ("09/11/2026 14:05") first
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial < 20000 || serial > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const [p0 = '', p1 = '', p2 = '', ...extra] = s.split(/[/.\-]/);
  if (extra.length || ![p0, p1, p2].every((p) => /^\d+$/.test(p))) return null;
  const [a, b, c] = [Number(p0), Number(p1), Number(p2)];
  if (format === 'yyyy-mm-dd') return p0.length === 4 ? iso(a, b, c) : null;
  const y = p2.length === 2 ? 2000 + c : p2.length === 4 ? c : Number.NaN;
  if (Number.isNaN(y)) return null;
  return format === 'dd/mm/yyyy' ? iso(y, b, a) : iso(y, a, b);
}

// ------------------------------------------------------------------ rows to statement lines

/** Which column (0-based) holds what. Either `amount` (one signed column) or `moneyIn` and/or `moneyOut`. */
export type StatementMapping = {
  date: number;
  description: number;
  reference?: number | null;
  valueDate?: number | null;
  amount?: number | null;
  moneyIn?: number | null;
  moneyOut?: number | null;
  balance?: number | null;
  dateFormat: StatementDateFormat;
  decimal?: '.' | ',';
  /** Rows at the top to skip (titles, the header row). */
  skipRows: number;
};

export type StatementLine = {
  /** 1-based row number in the file, for messages. */
  row: number;
  bookingDate: string;
  valueDate: string | null;
  description: string;
  reference: string;
  /** Minor units: positive = money into the account, negative = money out. Never zero. */
  amountMinor: number;
  balanceMinor: number | null;
};

export type StatementRowError = { row: number; reason: 'date' | 'amount' | 'both_in_and_out' | 'zero' | 'columns' };

/** Turns file rows into statement lines with a mapping. Rows that cannot be read are returned as errors (shown in the preview,
 *  never imported); nothing is guessed. */
export function readStatement(
  rows: string[][],
  m: StatementMapping,
  minorDigits = 2,
): { lines: StatementLine[]; errors: StatementRowError[] } {
  const lines: StatementLine[] = [];
  const errors: StatementRowError[] = [];
  const at = (r: string[], i: number | null | undefined) => (i == null ? '' : (r[i] ?? '').trim());
  const opts = { decimal: m.decimal ?? '.', minorDigits };
  if (m.amount == null && m.moneyIn == null && m.moneyOut == null) throw new Error('mapping needs an amount column, or money in / out');
  rows.forEach((r, idx) => {
    const row = idx + 1;
    if (idx < m.skipRows) return;
    if (r.length <= Math.max(m.date, m.description)) return errors.push({ row, reason: 'columns' });
    const bookingDate = parseStatementDate(at(r, m.date), m.dateFormat);
    if (!bookingDate) return errors.push({ row, reason: 'date' });
    let amount: number | null;
    if (m.amount != null) amount = parseStatementAmount(at(r, m.amount), opts);
    else {
      const inn = at(r, m.moneyIn) === '' ? null : parseStatementAmount(at(r, m.moneyIn), opts);
      const out = at(r, m.moneyOut) === '' ? null : parseStatementAmount(at(r, m.moneyOut), opts);
      if ((at(r, m.moneyIn) !== '' && inn === null) || (at(r, m.moneyOut) !== '' && out === null))
        return errors.push({ row, reason: 'amount' });
      if (inn && out) return errors.push({ row, reason: 'both_in_and_out' });
      amount = inn ? Math.abs(inn) : out ? -Math.abs(out) : inn === 0 || out === 0 ? 0 : null;
    }
    if (amount === null) return errors.push({ row, reason: 'amount' });
    if (amount === 0) return errors.push({ row, reason: 'zero' });
    const balanceText = at(r, m.balance);
    lines.push({
      row,
      bookingDate,
      valueDate: at(r, m.valueDate) ? parseStatementDate(at(r, m.valueDate), m.dateFormat) : null,
      description: at(r, m.description),
      reference: at(r, m.reference),
      amountMinor: amount,
      balanceMinor: balanceText ? parseStatementAmount(balanceText, opts) : null,
    });
  });
  return { lines, errors };
}

/** A stable key for a line, so an overlapping file never adds the same line twice. `occurrence` tells identical lines on the same
 *  day apart (the 1st, 2nd … identical line in the file). */
export function lineFingerprint(
  accountId: string,
  l: Pick<StatementLine, 'bookingDate' | 'amountMinor' | 'reference' | 'description'>,
  occurrence: number,
): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return [accountId, l.bookingDate, l.amountMinor, norm(l.reference), norm(l.description), occurrence].join('|');
}

/** Fingerprints for a whole file, counting identical lines within each day. */
export function fingerprints(accountId: string, lines: StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = lineFingerprint(accountId, l, 0);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return lineFingerprint(accountId, l, n);
  });
}

// ------------------------------------------------------------------ suggesting matches

/** A ledger line on the bank account that is not matched yet. amountMinor: positive = debit to the bank (money in). */
export type LedgerCandidate = { id: string; date: string; amountMinor: number; documentNumbers: string[] };

export type MatchTier = 'exact' | 'strong' | 'possible';
export type MatchSuggestion = {
  tier: MatchTier;
  candidateIds: string[];
  days: number;
  why: ('amount' | 'reference' | 'date' | 'only_one')[];
};

const dayDiff = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const squash = (s: string) =>
  westernNumber(s, '.')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Suggestions for one bank line, best first (plan §7): exact = same amount, our document number in the bank text, within 7 days;
 *  strong = same amount, within 3 days, the only such candidate; possible = same amount within 10 days. Suggestions only. */
export function suggestMatches(
  line: Pick<StatementLine, 'bookingDate' | 'amountMinor' | 'reference' | 'description'>,
  candidates: LedgerCandidate[],
): MatchSuggestion[] {
  const text = squash(`${line.reference} ${line.description}`);
  const same = candidates
    .filter((c) => c.amountMinor === line.amountMinor)
    .map((c) => ({ c, days: dayDiff(c.date, line.bookingDate) }))
    .filter((x) => x.days <= 10)
    .sort((a, b) => a.days - b.days || a.c.id.localeCompare(b.c.id));
  const exact = same.filter((x) => x.days <= 7 && x.c.documentNumbers.some((d) => squash(d).length >= 3 && text.includes(squash(d))));
  const out: MatchSuggestion[] = exact.map((x) => ({
    tier: 'exact',
    candidateIds: [x.c.id],
    days: x.days,
    why: ['amount', 'reference', 'date'],
  }));
  const rest = same.filter((x) => !exact.includes(x));
  const near = rest.filter((x) => x.days <= 3);
  const only = near[0];
  if (exact.length === 0 && same.length === 1 && near.length === 1 && only) {
    out.push({ tier: 'strong', candidateIds: [only.c.id], days: only.days, why: ['amount', 'date', 'only_one'] });
    return out;
  }
  for (const x of rest) out.push({ tier: 'possible', candidateIds: [x.c.id], days: x.days, why: ['amount', 'date'] });
  return out;
}

/** Several ledger lines on one day that add up exactly to the bank line (for example a deposit of several cheques), up to `max`
 *  lines, same direction. Returns at most a few groups, smallest first. Never confirmed in bulk. */
export function suggestGroups(
  line: Pick<StatementLine, 'bookingDate' | 'amountMinor'>,
  candidates: LedgerCandidate[],
  max = 5,
  withinDays = 3,
): string[][] {
  const pool = candidates
    .filter((c) => Math.sign(c.amountMinor) === Math.sign(line.amountMinor) && Math.abs(c.amountMinor) < Math.abs(line.amountMinor))
    .filter((c) => dayDiff(c.date, line.bookingDate) <= withinDays)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 25); // keeps the search small
  const found: string[][] = [];
  const pick = (start: number, left: number, chosen: LedgerCandidate[]) => {
    if (found.length >= 3) return;
    if (left === 0 && chosen.length >= 2) {
      found.push(chosen.map((c) => c.id));
      return;
    }
    if (chosen.length >= max) return;
    for (let i = start; i < pool.length; i++) {
      const c = pool[i];
      if (!c || Math.abs(c.amountMinor) > Math.abs(left)) continue;
      pick(i + 1, left - c.amountMinor, [...chosen, c]);
    }
  };
  pick(0, line.amountMinor, []);
  return found.sort((a, b) => a.length - b.length);
}

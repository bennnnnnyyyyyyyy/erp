// "Today" in the company's own time zone (UX decision D11, 9 Nov 2026). Forms used the browser's UTC date, so between midnight and
// 2-3 a.m. in Cairo a new invoice or payment was dated yesterday, and a sale just after midnight on the 1st landed in the old month.
// The time zone is the company setting (Settings > General), set once when the session loads, so plain functions can use it.

let companyTimeZone = 'UTC';

/** Called when the session loads or the company changes. An unknown zone falls back to UTC instead of breaking every form. */
export function setCompanyTimeZone(zone: string | null | undefined): void {
  if (!zone) return;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    companyTimeZone = zone;
  } catch {
    companyTimeZone = 'UTC';
  }
}

/** The calendar date (YYYY-MM-DD) it is now in the company's time zone, or in `zone` when given. */
export function todayIn(now: Date = new Date(), zone: string = companyTimeZone): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The first day of the current year in the company's time zone. */
export const firstOfYearIn = (now: Date = new Date(), zone: string = companyTimeZone): string => `${todayIn(now, zone).slice(0, 4)}-01-01`;

// ---------------------------------------------------------------- dates typed in the company's format (UX audit 20 Nov 2026)
// The browser's own date box follows the computer's language (11/20/2026 on an English Windows), not the company's Date format
// setting. components/DateInput.tsx shows and reads dates in the company format instead; the value kept is still YYYY-MM-DD.

const DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** "2026-11-20" written in the company format ("20/11/2026"); anything else unchanged. */
export function showDay(ymd: string, dateFormat: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const [, y, mo, d] = m;
  if (dateFormat === 'MM/DD/YYYY') return `${mo}/${d}/${y}`;
  if (dateFormat === 'YYYY-MM-DD') return `${y}-${mo}-${d}`;
  return `${d}/${mo}/${y}`;
}

/**
 * A date typed by a person, in the company format, as YYYY-MM-DD; null when it is not a real date. Accepts / - . or spaces between the
 * parts, one-digit day and month, and Arabic digits ("٢٠/١١/٢٠٢٦"). '' for an empty box.
 */
export function readDay(text: string, dateFormat: string | null | undefined): string | null {
  let s = '';
  // Direction marks some right-to-left keyboards insert (U+200E, U+200F, U+061C) are not part of the date (input and speed audit).
  for (const ch of text.replace(/[\u200e\u200f\u061c]/g, '').trim()) {
    const a = DIGITS.indexOf(ch);
    const p = PERSIAN.indexOf(ch);
    s += a >= 0 ? String(a) : p >= 0 ? String(p) : ch;
  }
  if (s === '') return '';
  const parts = s.split(/[/\-. ]+/);
  if (parts.length !== 3 || parts.some((x) => !/^\d+$/.test(x))) return null;
  const [a, b, c] = parts as [string, string, string];
  const [y, mo, d] = dateFormat === 'YYYY-MM-DD' ? [a, b, c] : dateFormat === 'MM/DD/YYYY' ? [c, a, b] : [c, b, a];
  if (y.length !== 4) return null;
  const yy = Number(y);
  // A sane year: 0001 or 9999 is a typing slip, not a business date.
  if (yy < 1900 || yy > 2100) return null;
  const mm = Number(mo);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1) return null;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (dd > last) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** The hint shown in an empty box: the company format in plain letters. */
export const dayPattern = (dateFormat: string | null | undefined): string =>
  dateFormat === 'MM/DD/YYYY' ? 'MM/DD/YYYY' : dateFormat === 'YYYY-MM-DD' ? 'YYYY-MM-DD' : 'DD/MM/YYYY';

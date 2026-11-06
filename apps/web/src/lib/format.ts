import type { SessionInfo } from '@erp/shared';

type OrgPrefs = Pick<NonNullable<SessionInfo['org']>, 'timezone' | 'dateFormat'>;

function parts(iso: string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { y: p.year, m: p.month, d: p.day, time: `${p.hour}:${p.minute}` };
}

/** A date in the organization's time zone and date format. */
export function formatDate(iso: string | null | undefined, org: OrgPrefs | null): string {
  if (!iso) return '';
  const { y, m, d } = parts(iso, org?.timezone ?? 'UTC');
  switch (org?.dateFormat) {
    case 'MM/DD/YYYY':
      return `${m}/${d}/${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${m}-${d}`;
    default:
      return `${d}/${m}/${y}`;
  }
}

/**
 * A calendar date ("2026-11-01": an invoice date, an expiry date, a payment day) in the organization's date format. Unlike formatDate
 * it never shifts by time zone: the date is the date, wherever the company is. Anything that is not YYYY-MM-DD is returned unchanged.
 */
export function formatDay(ymd: string | null | undefined, org: Pick<OrgPrefs, 'dateFormat'> | null): string {
  if (!ymd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const [, y, mo, d] = m;
  switch (org?.dateFormat) {
    case 'MM/DD/YYYY':
      return `${mo}/${d}/${y}`;
    case 'YYYY-MM-DD':
      return `${y}-${mo}-${d}`;
    default:
      return `${d}/${mo}/${y}`;
  }
}

export function formatDateTime(iso: string | null | undefined, org: OrgPrefs | null): string {
  if (!iso) return '';
  return `${formatDate(iso, org)} ${parts(iso, org?.timezone ?? 'UTC').time}`;
}

/** "30 × Safety gloves": a quantity and an item name. The × is the same in both languages. */
export const qtyLine = (qty: number | string, name: string): string => `${qty} × ${name}`;

/**
 * Keeps a piece of left-to-right text (a quantity line, a code) in its own order inside an Arabic sentence. Without it the bidi
 * algorithm moves the number to the wrong end ("x Safety gloves 30"). For display only: never put it in a CSV or a search value.
 */
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
export const ltrIsolate = (text: string): string => `${LRI}${text}${PDI}`;


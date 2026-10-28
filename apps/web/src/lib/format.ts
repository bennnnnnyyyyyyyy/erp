import type { SessionInfo } from '@ggo/shared';

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

export function formatDateTime(iso: string | null | undefined, org: OrgPrefs | null): string {
  if (!iso) return '';
  return `${formatDate(iso, org)} ${parts(iso, org?.timezone ?? 'UTC').time}`;
}

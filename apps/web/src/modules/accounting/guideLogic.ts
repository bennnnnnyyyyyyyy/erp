// Pure logic of the guided accounting setup (SetupGuide.tsx): what the first fiscal year is for a chosen start date, and which of the
// three steps is the one to do next. No business rules live here; the database and the existing set-up routes decide what is allowed.

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The first fiscal year for a books start date (YYYY-MM-DD): it runs one year, ending the day before the next anniversary.
 * A year starting on 1 January is named "FY2026"; any other start is named "2026-2027". Returns null for anything that is not a date.
 */
export function firstFiscalYear(startsOn: string): { name: string; startsOn: string; endsOn: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const end = new Date(Date.UTC(y + 1, mo - 1, d - 1));
  const endsOn = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`;
  const name = mo === 1 && d === 1 ? `FY${y}` : `${y}-${y + 1}`;
  return { name, startsOn, endsOn };
}

export type GuideStep = 'opening-date' | 'chart' | 'switch-on';

/** The step to do next: the date first, then the chart, then the switch itself (opening balances are entered after it, so they are a note, not a step to finish). Once accounting is on, none. */
export function nextGuideStep(a: { accountingOn: boolean; fiscalYears: number; chartAccounts: number }): GuideStep | null {
  if (a.accountingOn) return null;
  if (a.fiscalYears === 0) return 'opening-date';
  if (a.chartAccounts === 0) return 'chart';
  return 'switch-on';
}

/** The earliest start among the company's fiscal years (the day the books start), or null when there are none. */
export function booksStart(years: { startsOn: string }[]): string | null {
  return years.reduce<string | null>((min, y) => (min === null || y.startsOn < min ? y.startsOn : min), null);
}

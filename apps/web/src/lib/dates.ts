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

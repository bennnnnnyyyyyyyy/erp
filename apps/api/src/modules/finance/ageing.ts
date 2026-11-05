// Receivables and payables ageing (sql/041 due dates). Pure, so it is unit-tested without a database.
// Dates are business dates (YYYY-MM-DD) compared as UTC calendar days.

export type AgeBucket = 'not_due' | '1_30' | '31_60' | '61_90' | 'over_90';

const DAY = 86_400_000;

/** Whole days between due date and today; positive when overdue, 0 or less when not yet due. */
export function daysOverdue(dueDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY);
}

export function ageBucket(days: number): AgeBucket {
  if (days <= 0) return 'not_due';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'over_90';
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

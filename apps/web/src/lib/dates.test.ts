import { describe, expect, it } from 'vitest';
import { firstOfYearIn, todayIn } from './dates';

describe('todayIn', () => {
  // 31 Dec 2026, 23:30 UTC is already 1 Jan 2027 in Cairo (UTC+2): the case that dated sales into the wrong month and year.
  const lateUtc = new Date('2026-12-31T23:30:00Z');

  it('uses the company time zone, not UTC', () => {
    expect(todayIn(lateUtc, 'Africa/Cairo')).toBe('2027-01-01');
    expect(todayIn(lateUtc, 'UTC')).toBe('2026-12-31');
  });

  it('gives the first day of the company year', () => {
    expect(firstOfYearIn(lateUtc, 'Africa/Cairo')).toBe('2027-01-01');
    expect(firstOfYearIn(lateUtc, 'UTC')).toBe('2026-01-01');
  });
});

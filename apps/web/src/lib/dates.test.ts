import { describe, expect, it } from 'vitest';
import { dayPattern, firstOfYearIn, readDay, showDay, todayIn } from './dates';

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

describe('dates in the company format (UX audit 20 Nov: date boxes showed month/day/year)', () => {
  it('shows a date in each format', () => {
    expect(showDay('2026-11-20', 'DD/MM/YYYY')).toBe('20/11/2026');
    expect(showDay('2026-11-20', 'MM/DD/YYYY')).toBe('11/20/2026');
    expect(showDay('2026-11-20', 'YYYY-MM-DD')).toBe('2026-11-20');
    expect(showDay('', 'DD/MM/YYYY')).toBe('');
  });
  it('reads what people type in the company format', () => {
    expect(readDay('20/11/2026', 'DD/MM/YYYY')).toBe('2026-11-20');
    expect(readDay('5-1-2026', 'DD/MM/YYYY')).toBe('2026-01-05');
    expect(readDay('٢٠/١١/٢٠٢٦', 'DD/MM/YYYY')).toBe('2026-11-20');
    expect(readDay('11/20/2026', 'MM/DD/YYYY')).toBe('2026-11-20');
    expect(readDay('2026-11-20', 'YYYY-MM-DD')).toBe('2026-11-20');
    expect(readDay('', 'DD/MM/YYYY')).toBe('');
  });
  it('refuses what is not a real date', () => {
    expect(readDay('31/02/2026', 'DD/MM/YYYY')).toBeNull();
    expect(readDay('11/20/2026', 'DD/MM/YYYY')).toBeNull();
    expect(readDay('20/11/26', 'DD/MM/YYYY')).toBeNull();
    expect(readDay('tomorrow', 'DD/MM/YYYY')).toBeNull();
  });
});

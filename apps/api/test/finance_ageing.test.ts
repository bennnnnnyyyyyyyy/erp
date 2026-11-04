import { describe, expect, it } from 'vitest';
import { ageBucket, daysOverdue, todayUtc } from '../src/modules/finance/ageing';

describe('ageing (sql/041 due dates)', () => {
  it('counts whole days past the due date', () => {
    expect(daysOverdue('2026-11-01', '2026-11-03')).toBe(2);
    expect(daysOverdue('2026-11-03', '2026-11-03')).toBe(0);
    expect(daysOverdue('2026-11-10', '2026-11-03')).toBe(-7);
    expect(daysOverdue('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('puts each day count in one bucket, edges included', () => {
    expect(ageBucket(-3)).toBe('not_due');
    expect(ageBucket(0)).toBe('not_due');
    expect(ageBucket(1)).toBe('1_30');
    expect(ageBucket(30)).toBe('1_30');
    expect(ageBucket(31)).toBe('31_60');
    expect(ageBucket(60)).toBe('31_60');
    expect(ageBucket(61)).toBe('61_90');
    expect(ageBucket(90)).toBe('61_90');
    expect(ageBucket(91)).toBe('over_90');
  });

  it('gives today as a UTC calendar date', () => {
    expect(todayUtc(new Date('2026-11-03T23:30:00Z'))).toBe('2026-11-03');
  });
});

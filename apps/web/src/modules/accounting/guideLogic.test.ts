import { describe, expect, it } from 'vitest';
import { booksStart, firstFiscalYear, nextGuideStep } from './guideLogic';

describe('firstFiscalYear', () => {
  it('names a calendar year FY and ends it on 31 December', () => {
    expect(firstFiscalYear('2026-01-01')).toEqual({ name: 'FY2026', startsOn: '2026-01-01', endsOn: '2026-12-31' });
  });
  it('ends a year the day before the next anniversary', () => {
    expect(firstFiscalYear('2026-07-01')).toEqual({ name: '2026-2027', startsOn: '2026-07-01', endsOn: '2027-06-30' });
    expect(firstFiscalYear('2026-03-15')?.endsOn).toBe('2027-03-14');
  });
  it('handles 29 February and rejects what is not a date', () => {
    expect(firstFiscalYear('2024-02-29')?.endsOn).toBe('2025-02-28');
    expect(firstFiscalYear('2026-02-30')).toBeNull();
    expect(firstFiscalYear('')).toBeNull();
    expect(firstFiscalYear('1/1/2026')).toBeNull();
  });
});

describe('nextGuideStep', () => {
  it('goes date, chart, then switch-on', () => {
    expect(nextGuideStep({ accountingOn: false, fiscalYears: 0, chartAccounts: 0 })).toBe('opening-date');
    expect(nextGuideStep({ accountingOn: false, fiscalYears: 0, chartAccounts: 50 })).toBe('opening-date');
    expect(nextGuideStep({ accountingOn: false, fiscalYears: 1, chartAccounts: 0 })).toBe('chart');
    expect(nextGuideStep({ accountingOn: false, fiscalYears: 1, chartAccounts: 50 })).toBe('switch-on');
  });
  it('has no next step once accounting is on', () => {
    expect(nextGuideStep({ accountingOn: true, fiscalYears: 0, chartAccounts: 0 })).toBeNull();
  });
});

describe('booksStart', () => {
  it('is the earliest start, or null', () => {
    expect(booksStart([])).toBeNull();
    expect(booksStart([{ startsOn: '2026-01-01' }, { startsOn: '2025-04-01' }])).toBe('2025-04-01');
  });
});

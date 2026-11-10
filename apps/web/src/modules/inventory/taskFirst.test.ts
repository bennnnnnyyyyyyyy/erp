import { describe, expect, it } from 'vitest';
import { emptyColumnKeys, isBlank } from './taskFirst';

type Row = { nameAr: string; reserved: number | null; cost: number | null };

describe('emptyColumnKeys', () => {
  const get = { ar: (r: Row) => r.nameAr, reserved: (r: Row) => r.reserved, cost: (r: Row) => r.cost };
  it('lists the columns that are empty in every row', () => {
    const rows: Row[] = [{ nameAr: '', reserved: null, cost: 5 }, { nameAr: '  ', reserved: null, cost: null }];
    expect([...emptyColumnKeys(rows, get)].sort()).toEqual(['ar', 'reserved']);
  });
  it('keeps a column when one row has a value, and treats zero as a value', () => {
    const rows: Row[] = [{ nameAr: '', reserved: 0, cost: null }, { nameAr: 'زيت', reserved: null, cost: null }];
    expect([...emptyColumnKeys(rows, get)]).toEqual(['cost']);
  });
  it('hides nothing when there are no rows', () => {
    expect(emptyColumnKeys([], get).size).toBe(0);
  });
  it('isBlank', () => {
    expect([isBlank(null), isBlank(undefined), isBlank(''), isBlank(' '), isBlank(0), isBlank('a')]).toEqual([true, true, true, true, false, false]);
  });
});

import { describe, expect, it } from 'vitest';
import { tidy } from './definition';

describe('tidy', () => {
  it('keeps a sort and a chart on shown columns', () => {
    const d = { source: 's', columns: ['item', 'qty'], sort: [{ column: 'qty', dir: 'desc' as const }], chart: { type: 'bar' as const, x: 'item', y: 'qty' } };
    expect(tidy(d)).toEqual(d);
  });

  it('drops a sort and a chart on columns no longer shown', () => {
    const d = { source: 's', columns: ['item'], sort: [{ column: 'qty', dir: 'desc' as const }], chart: { type: 'bar' as const, x: 'item', y: 'qty' } };
    expect(tidy(d)).toEqual({ source: 's', columns: ['item'], sort: [], chart: null });
  });

  it('a grouped report shows its groups and totals only', () => {
    const d = {
      source: 's',
      columns: ['item', 'qty'],
      groupBy: ['item'],
      totals: [{ column: 'qty', fn: 'sum' as const }],
      sort: [{ column: 'sum_qty', dir: 'desc' as const }, { column: 'qty', dir: 'asc' as const }],
    };
    const t = tidy(d);
    expect(t.columns).toEqual([]);
    expect(t.sort).toEqual([{ column: 'sum_qty', dir: 'desc' }]);
  });
});

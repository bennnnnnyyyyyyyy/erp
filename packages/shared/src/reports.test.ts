import { describe, expect, it } from 'vitest';
import { reportDefinitionProblem, reportFnsFor, reportOpsFor, reportOutputKeys, type ReportSource } from './reports';

const src: ReportSource = {
  key: 'stock_moves',
  module: 'inventory',
  period: 'move_date',
  periodRequired: true,
  hasCurrency: false,
  columns: [
    { key: 'move_date', type: 'date' },
    { key: 'item', type: 'text' },
    { key: 'qty', type: 'number' },
  ],
};
const ok = { source: 'stock_moves', columns: ['item', 'qty'], period: { from: '2026-11-01', to: '2026-11-30' } };

describe('report definitions', () => {
  it('accepts a plain and a grouped definition', () => {
    expect(reportDefinitionProblem(ok, src)).toBeNull();
    expect(
      reportDefinitionProblem(
        {
          ...ok,
          columns: [],
          groupBy: ['item'],
          totals: [{ column: 'qty', fn: 'sum' }],
          sort: [{ column: 'sum_qty', dir: 'desc' }],
          chart: { type: 'bar', x: 'item', y: 'sum_qty' },
        },
        src,
      ),
    ).toBeNull();
  });

  it('refuses what is not on the list', () => {
    const bad: unknown[] = [
      null,
      [],
      { ...ok, sql: 'select 1' },
      { ...ok, source: 'Robert"); drop table' },
      { ...ok, columns: ['unit_cost_minor'] },
      { ...ok, columns: ['item', 'item'] },
      { ...ok, columns: [] },
      { ...ok, period: undefined },
      { ...ok, period: { from: '2026-12-01', to: '2026-11-01' } },
      { ...ok, period: { from: '2020-01-01', to: '2026-01-01' } },
      { ...ok, groupBy: ['qty'], totals: [{ column: 'qty', fn: 'sum' }] },
      { ...ok, groupBy: ['item'] },
      { ...ok, totals: [{ column: 'item', fn: 'sum' }] },
      { ...ok, filters: [{ column: 'qty', op: 'contains', value: '1' }] },
      { ...ok, filters: [{ column: 'qty', op: 'eq', value: '1 or 1=1' }] },
      { ...ok, filters: [{ column: 'move_date', op: 'eq', value: '2026-02-30' }] },
      { ...ok, filters: [{ column: 'item', op: 'in', value: [] }] },
      { ...ok, sort: [{ column: 'move_date', dir: 'asc' }] },
      { ...ok, limit: 6000 },
      { ...ok, chart: { type: 'radar', x: 'item', y: 'qty' } },
    ];
    for (const d of bad) expect(reportDefinitionProblem(d, src), JSON.stringify(d)).not.toBeNull();
  });

  it('works without the source list too (shape and limits only)', () => {
    expect(reportDefinitionProblem(ok)).toBeNull();
    expect(reportDefinitionProblem({ ...ok, columns: Array.from({ length: 21 }, (_, i) => `c${i}`) })).not.toBeNull();
  });

  it('offers only the operators and totals that fit a column', () => {
    expect(reportOpsFor('text')).not.toContain('gt');
    expect(reportOpsFor('number')).not.toContain('contains');
    expect(reportFnsFor('text')).toEqual(['count']);
    expect(reportFnsFor('money')).toContain('sum');
  });

  it('names the output columns as the database does', () => {
    expect(reportOutputKeys(ok)).toEqual(['item', 'qty']);
    expect(reportOutputKeys({ source: 'x', groupBy: ['item'], totals: [{ column: 'qty', fn: 'sum' }] })).toEqual(['item', 'sum_qty']);
  });
});

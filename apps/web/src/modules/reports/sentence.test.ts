import type { ReportSource } from '@erp/shared';
import { reportDefinitionProblem } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { presetPeriod } from './definition';
import { LIST, defaultMeasure, measureChoices, measureOf, periodChoice, splitOf, withMeasure, withSplit } from './sentence';

const src: ReportSource = {
  key: 'sales_lines',
  module: 'sales',
  period: 'invoice_date',
  periodRequired: true,
  hasCurrency: true,
  columns: [
    { key: 'invoice_date', type: 'date' },
    { key: 'customer', type: 'text' },
    { key: 'item', type: 'text' },
    { key: 'qty', type: 'number' },
    { key: 'net', type: 'money' },
    { key: 'total', type: 'money' },
  ],
};
const today = '2026-11-24';
const start = { source: 'sales_lines', columns: ['invoice_date', 'customer'], period: presetPeriod('this_month', today) };

describe('the report sentence', () => {
  it('offers each number added up, a count and the list, and starts from the whole amount', () => {
    expect(measureChoices(src)).toEqual(['sum_qty', 'sum_net', 'sum_total', 'count_invoice_date', LIST]);
    expect(defaultMeasure(src)).toBe('sum_total');
  });

  it('"Show Total by Customer" is a valid grouped report with bars', () => {
    const d = withSplit(withMeasure(start, 'sum_total', src), 'customer', src);
    expect(d.groupBy).toEqual(['customer']);
    expect(d.totals).toEqual([{ fn: 'sum', column: 'total' }]);
    expect(d.chart).toEqual({ type: 'bar', x: 'customer', y: 'sum_total' });
    expect(measureOf(d)).toBe('sum_total');
    expect(splitOf(d)).toBe('customer');
    expect(reportDefinitionProblem(d, src)).toBeNull();
  });

  it('a split with no total adds the starting total', () => {
    const d = withSplit(start, 'item', src);
    expect(d.totals).toEqual([{ fn: 'sum', column: 'total' }]);
    expect(reportDefinitionProblem(d, src)).toBeNull();
  });

  it('changing "what" keeps the other totals and the chart type, on the new total', () => {
    let d = withSplit(withMeasure(start, 'sum_total', src), 'customer', src);
    d = { ...d, totals: [...(d.totals ?? []), { fn: 'sum', column: 'qty' }], chart: { type: 'pie', x: 'customer', y: 'sum_total' } };
    d = withMeasure(d, 'sum_qty', src);
    expect(d.totals).toEqual([{ fn: 'sum', column: 'qty' }, { fn: 'sum', column: 'total' }]);
    expect(d.chart).toEqual({ type: 'pie', x: 'customer', y: 'sum_qty' });
  });

  it('"Each line" is a plain list again, and "every line" keeps the total under the list', () => {
    const g = withSplit(withMeasure(start, 'sum_total', src), 'customer', src);
    const list = withMeasure(g, LIST, src);
    expect(list.groupBy).toEqual([]);
    expect(list.totals).toEqual([]);
    expect(list.columns).toEqual(['invoice_date', 'customer']);
    expect(reportDefinitionProblem(list, src)).toBeNull();
    const lines = withSplit(g, '', src);
    expect(lines.groupBy).toEqual([]);
    expect(lines.totals).toEqual([{ fn: 'sum', column: 'total' }]);
    expect(lines.chart).toBeNull();
    expect(reportDefinitionProblem(lines, src)).toBeNull();
  });

  it('reads the period back as a choice', () => {
    expect(periodChoice(start, today)).toBe('this_month');
    expect(periodChoice({ ...start, period: { from: '2026-01-05', to: '2026-02-01' } }, today)).toBe('custom');
    expect(periodChoice({ ...start, period: null }, today)).toBe('any');
  });
});

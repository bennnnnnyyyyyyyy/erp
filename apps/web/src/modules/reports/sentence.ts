import type { ReportDefinition, ReportPeriodPreset, ReportSource, ReportTotal, ReportTotalFn } from '@erp/shared';
import { presetPeriod } from './definition';

/** The period choices the sentence offers, in order. */
export const REPORT_PERIOD_PRESETS_SHOWN: ReportPeriodPreset[] = ['this_month', 'last_month', 'last_30', 'this_year'];

// The report builder as one sentence (Ben's choice, 24 Nov 2026: option A): "Show [what] by [split] for [period]". These helpers turn
// the sentence's choices into the same report definition as before (sql/109 is unchanged), and read a saved or ready-made report back
// into the sentence. "What" is a total ('sum_net', 'count_invoice_number') or 'list' (every line, no total).

export const LIST = 'list';
const TOTAL_KEY = /^(sum|count|avg|min|max)_(.+)$/;

export const totalKey = (t: ReportTotal) => `${t.fn}_${t.column}`;
export function parseTotal(key: string): ReportTotal | null {
  const m = TOTAL_KEY.exec(key);
  return m ? { fn: m[1] as ReportTotalFn, column: m[2] as string } : null;
}

/** The first columns of a source: what a list shows when nothing else was chosen. */
export const defaultColumns = (s: ReportSource) => s.columns.slice(0, 5).map((c) => c.key);

/** The "what" choices of a source: each money or number column added up, the number of lines, or every line. */
export function measureChoices(s: ReportSource): string[] {
  const adds = s.columns.filter((c) => c.type === 'money' || c.type === 'number').map((c) => `sum_${c.key}`);
  const first = s.columns[0];
  return [...adds, ...(first ? [`count_${first.key}`] : []), LIST];
}

/** The total a new summary starts with: the money column that is the whole amount, else the first money or number column, else a count. */
export function defaultMeasure(s: ReportSource): string {
  const money = s.columns.filter((c) => c.type === 'money');
  const whole = money.find((c) => c.key === 'total' || c.key === 'amount' || c.key === 'owed' || c.key === 'invoice_total') ?? money[0];
  const num = whole ?? s.columns.find((c) => c.type === 'number');
  return num ? `sum_${num.key}` : `count_${s.columns[0]?.key ?? ''}`;
}

/** The "by" choices: text and date columns. */
export const splitChoices = (s: ReportSource) => s.columns.filter((c) => c.type === 'text' || c.type === 'date').map((c) => c.key);

export const measureOf = (d: ReportDefinition): string => (d.totals?.[0] ? totalKey(d.totals[0]) : LIST);
export const splitOf = (d: ReportDefinition): string => d.groupBy?.[0] ?? '';

/** The chart that fits: kept as it was when it still fits, bars for a new split, none for a list. */
function fitChart(d: ReportDefinition, wasGrouped: boolean): ReportDefinition {
  const g = d.groupBy?.[0];
  const t = d.totals?.[0];
  if (!g || !t) return { ...d, chart: null };
  if (!wasGrouped && !d.chart) return { ...d, chart: { type: 'bar', x: g, y: totalKey(t) } };
  return d.chart ? { ...d, chart: { ...d.chart, x: g, y: totalKey(t) } } : d;
}

/** Chooses "what": a total moves to the front (the other totals stay as "also show"), or 'list' drops the split and the totals. */
export function withMeasure(d: ReportDefinition, measure: string, s: ReportSource): ReportDefinition {
  const grouped = (d.groupBy ?? []).length > 0;
  const columns = d.columns && d.columns.length > 0 ? d.columns : defaultColumns(s);
  if (measure === LIST) return { ...d, columns, groupBy: [], totals: [], chart: null };
  const t = parseTotal(measure);
  if (!t) return d;
  const rest = (d.totals ?? []).filter((x) => totalKey(x) !== measure);
  return fitChart({ ...d, columns, totals: [t, ...rest.slice(0, 4)] }, grouped);
}

/** Chooses "by": a column (a total is added when there is none), or '' for every line (the totals stay, under the list). */
export function withSplit(d: ReportDefinition, split: string, s: ReportSource): ReportDefinition {
  const grouped = (d.groupBy ?? []).length > 0;
  const columns = d.columns && d.columns.length > 0 ? d.columns : defaultColumns(s);
  if (!split) return { ...d, columns, groupBy: [], chart: null };
  const totals = d.totals && d.totals.length > 0 ? d.totals : [parseTotal(defaultMeasure(s)) as ReportTotal];
  const groupBy = [split, ...(d.groupBy ?? []).slice(1).filter((g) => g !== split)];
  return fitChart({ ...d, columns, groupBy, totals }, grouped);
}

/** The period choice that matches the report's dates, or 'custom'. */
export function periodChoice(d: ReportDefinition, today?: string): ReportPeriodPreset | 'custom' | 'any' {
  if (!d.period) return 'any';
  const hit = REPORT_PERIOD_PRESETS_SHOWN.find((k) => {
    const p = presetPeriod(k, today);
    return p.from === d.period?.from && p.to === d.period?.to;
  });
  return hit ?? 'custom';
}

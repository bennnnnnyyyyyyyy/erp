import { reportOutputKeys, type ReportDefinition } from '@erp/shared';

/**
 * Drops the choices that point at columns no longer shown (after a change of columns, grouping or totals): the sort, the chart, and the
 * plain columns of a grouped report (a grouped report shows its group-by columns and totals only).
 */
export function tidy(def: ReportDefinition): ReportDefinition {
  const grouped = (def.groupBy ?? []).length > 0;
  const shaped = { ...def, columns: grouped ? [] : def.columns };
  const keys = reportOutputKeys(shaped);
  const sort = (def.sort ?? []).filter((s) => keys.includes(s.column));
  const chart = def.chart && keys.includes(def.chart.x) && keys.includes(def.chart.y) ? def.chart : null;
  return { ...shaped, sort, chart };
}

import { reportOutputKeys, type ReportDefinition, type ReportPeriodPreset, type ReportTemplate } from '@erp/shared';
import { todayIn } from '../../lib/dates';

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The dates of a period choice, in the company's time zone. `today` is for tests. */
export function presetPeriod(kind: ReportPeriodPreset, today: string = todayIn()): { from: string; to: string } {
  const t = new Date(`${today}T00:00:00Z`);
  if (kind === 'this_month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (kind === 'last_month') {
    const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
    return { from: ymd(first), to: ymd(last) };
  }
  if (kind === 'last_30') return { from: ymd(new Date(t.getTime() - 29 * 86_400_000)), to: today };
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/** A ready-made report as a definition to run: its period choice turned into dates. */
export function templateDefinition(t: ReportTemplate, today: string = todayIn()): ReportDefinition {
  return { ...t.definition, period: t.period ? presetPeriod(t.period, today) : null };
}

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

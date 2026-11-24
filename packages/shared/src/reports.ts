// Reports & Insights (documentation/plans/REPORTS_INSIGHTS_PLAN.md, sql/109). The report builder sends a definition: a choice from the
// fixed list of sources the database offers (rpt_sources). It is never SQL. The database checks every definition again (rpt__check)
// and runs it for the caller's company only. The checks here give the person a clear message early; they are not the security.

export type ReportColumnType = 'text' | 'number' | 'money' | 'date';
/** Output columns are the source's types, plus `currency` (added whenever money is shown: money is never added across currencies). */
export type ReportOutputType = ReportColumnType | 'currency';

export type ReportSourceColumn = { key: string; type: ReportColumnType };
export type ReportSource = {
  key: string;
  module: string;
  /** The date column the period filters on, or null for a snapshot (stock on hand). */
  period: string | null;
  periodRequired: boolean;
  hasCurrency: boolean;
  columns: ReportSourceColumn[];
};

export const REPORT_FILTER_OPS = ['eq', 'ne', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty'] as const;
export type ReportFilterOp = (typeof REPORT_FILTER_OPS)[number];
export const REPORT_TOTAL_FNS = ['sum', 'count', 'avg', 'min', 'max'] as const;
export type ReportTotalFn = (typeof REPORT_TOTAL_FNS)[number];
export const REPORT_CHART_TYPES = ['bar', 'line', 'pie'] as const;
export type ReportChartType = (typeof REPORT_CHART_TYPES)[number];

/** Filter values: text as strings, numbers as numbers, money as integer minor units, dates as 'YYYY-MM-DD'. */
export type ReportFilterValue = string | number | (string | number)[] | null;
export type ReportFilter = { column: string; op: ReportFilterOp; value?: ReportFilterValue };
export type ReportTotal = { column: string; fn: ReportTotalFn };
export type ReportSort = { column: string; dir: 'asc' | 'desc' };

export type ReportDefinition = {
  source: string;
  columns?: string[];
  filters?: ReportFilter[];
  period?: { from: string; to: string } | null;
  groupBy?: string[];
  totals?: ReportTotal[];
  sort?: ReportSort[];
  limit?: number | null;
  chart?: { type: ReportChartType; x: string; y: string } | null;
};

export type ReportCell = string | number | null;
export type ReportResult = {
  columns: { key: string; type: ReportOutputType }[];
  rows: ReportCell[][];
  /** The totals asked for, in order; each total's values are in `totalRows[n].values` at the same index. */
  totals: { key: string; fn: ReportTotalFn; column: string; type: ReportOutputType }[];
  /** One line per currency when a money total is asked for, else one line with `currency: null`. Over every matching row. */
  totalRows: { currency: string | null; values: (number | null)[] }[];
  /** More rows matched than the limit (at most 5,000). */
  truncated: boolean;
};

export type ReportVisibility = 'company' | 'private';
export type SavedReport = {
  id: string;
  name: string;
  description: string | null;
  definition: ReportDefinition;
  templateKey: string | null;
  visibility: ReportVisibility;
  /** True when the caller made it (only the maker changes a private report; owners and admins change company reports). */
  mine: boolean;
  updatedAt: string;
};

export const REPORT_LIMITS = { columns: 20, groupBy: 2, totals: 5, filters: 10, sort: 3, rows: 5000, periodDays: 1096 } as const;

/** The operators that fit a column type (the database allows exactly these). */
export function reportOpsFor(type: ReportColumnType): ReportFilterOp[] {
  if (type === 'text') return ['eq', 'ne', 'in', 'contains', 'is_empty'];
  if (type === 'date') return ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty'];
  return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty'];
}

/** The total functions that fit a column type. */
export function reportFnsFor(type: ReportColumnType): ReportTotalFn[] {
  if (type === 'text') return ['count'];
  if (type === 'date') return ['count', 'min', 'max'];
  return ['sum', 'avg', 'min', 'max', 'count'];
}

/** The output keys of a definition: its columns, or when grouped the group-by columns then each total as `<fn>_<column>`. */
export function reportOutputKeys(def: ReportDefinition): string[] {
  const groups = def.groupBy ?? [];
  if (groups.length > 0) return [...groups, ...(def.totals ?? []).map((t) => `${t.fn}_${t.column}`)];
  return [...(def.columns ?? [])];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-z][a-z0-9_]{0,60}$/;
// A real calendar day: JavaScript turns 30 February into 2 March, so the date must read back the same.
const isDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
};

/**
 * The first problem with a definition, as a plain sentence, or null. Checks the shape and the limits, and (when the source is given)
 * that every column exists and every operator and function fits its column. The database checks all of it again.
 */
export function reportDefinitionProblem(def: unknown, source?: ReportSource): string | null {
  if (!def || typeof def !== 'object' || Array.isArray(def)) return 'The report settings are missing.';
  const d = def as Record<string, unknown>;
  const known = ['source', 'columns', 'filters', 'period', 'groupBy', 'totals', 'sort', 'limit', 'chart'];
  if (Object.keys(d).some((k) => !known.includes(k))) return 'The report has a setting we do not know.';
  if (typeof d.source !== 'string' || !KEY_RE.test(d.source)) return 'Choose what the report is about.';
  if (source && source.key !== d.source) return 'Choose what the report is about.';
  const strings = (v: unknown) =>
    v === undefined || v === null || (Array.isArray(v) && v.every((x) => typeof x === 'string' && KEY_RE.test(x)));
  if (!strings(d.columns) || !strings(d.groupBy)) return 'Columns are not valid.';
  const columns = (d.columns as string[] | undefined) ?? [];
  const groups = (d.groupBy as string[] | undefined) ?? [];
  if (columns.length > REPORT_LIMITS.columns) return `Choose at most ${REPORT_LIMITS.columns} columns.`;
  if (groups.length > REPORT_LIMITS.groupBy) return `Group by at most ${REPORT_LIMITS.groupBy} columns.`;
  if (new Set(columns).size !== columns.length || new Set(groups).size !== groups.length) return 'A column is chosen twice.';
  if (groups.length === 0 && columns.length === 0) return 'Choose at least one column.';
  const typeOf = (k: string) => source?.columns.find((c) => c.key === k)?.type;
  if (source && [...columns, ...groups].some((k) => !typeOf(k))) return 'A column is not part of this source.';
  if (source && groups.some((k) => typeOf(k) !== 'text' && typeOf(k) !== 'date')) return 'Group by a text or date column.';

  const totals = d.totals ?? [];
  if (!Array.isArray(totals) || totals.length > REPORT_LIMITS.totals) return `Choose at most ${REPORT_LIMITS.totals} totals.`;
  const totalKeys: string[] = [];
  for (const t of totals as Record<string, unknown>[]) {
    if (!t || typeof t.column !== 'string' || !REPORT_TOTAL_FNS.includes(t.fn as ReportTotalFn)) return 'A total is not valid.';
    const type = typeOf(t.column);
    if (source && (!type || !reportFnsFor(type).includes(t.fn as ReportTotalFn))) return 'A total does not fit its column.';
    totalKeys.push(`${t.fn}_${t.column}`);
  }
  if (new Set(totalKeys).size !== totalKeys.length) return 'A total is chosen twice.';
  if (groups.length > 0 && totalKeys.length === 0) return 'A grouped report needs at least one total.';

  const filters = d.filters ?? [];
  if (!Array.isArray(filters) || filters.length > REPORT_LIMITS.filters) return `Use at most ${REPORT_LIMITS.filters} filters.`;
  for (const f of filters as Record<string, unknown>[]) {
    if (!f || typeof f.column !== 'string' || !REPORT_FILTER_OPS.includes(f.op as ReportFilterOp)) return 'A filter is not valid.';
    const type = typeOf(f.column);
    if (source && (!type || !reportOpsFor(type).includes(f.op as ReportFilterOp))) return 'A filter does not fit its column.';
    const v = f.value;
    if (f.op === 'is_empty') continue;
    if (
      f.op === 'in'
        ? !Array.isArray(v) || v.length === 0 || v.length > 50
        : f.op === 'between'
          ? !Array.isArray(v) || v.length !== 2
          : v === undefined || v === null || v === ''
    ) {
      return 'A filter needs a value.';
    }
    const vals = Array.isArray(v) ? v : [v];
    if (type === 'date' && !vals.every(isDate)) return 'A filter date is not valid.';
    if ((type === 'number' || type === 'money') && !vals.every((x) => typeof x === 'number' && Number.isFinite(x)))
      return 'A filter number is not valid.';
    if (type === 'money' && !vals.every((x) => Number.isInteger(x))) return 'A filter amount is not valid.';
  }

  const p = d.period;
  if (p !== undefined && p !== null) {
    if (typeof p !== 'object' || !isDate((p as { from?: unknown }).from) || !isDate((p as { to?: unknown }).to))
      return 'Choose a period with a start and an end date.';
    const { from, to } = p as { from: string; to: string };
    if (from > to) return 'The period starts after it ends.';
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > REPORT_LIMITS.periodDays) return 'The period is at most 3 years.';
    if (source && !source.period) return 'This report has no period.';
  } else if (source?.periodRequired) {
    return 'Choose a period.';
  }

  const keys = groups.length > 0 ? [...groups, ...totalKeys] : columns;
  const sort = d.sort ?? [];
  if (!Array.isArray(sort) || sort.length > REPORT_LIMITS.sort) return `Sort by at most ${REPORT_LIMITS.sort} columns.`;
  for (const s of sort as Record<string, unknown>[]) {
    if (!s || !keys.includes(s.column as string) || (s.dir !== 'asc' && s.dir !== 'desc')) return 'Sort by a column that is shown.';
  }
  if (
    d.limit !== undefined &&
    d.limit !== null &&
    !(Number.isInteger(d.limit) && (d.limit as number) >= 1 && (d.limit as number) <= REPORT_LIMITS.rows)
  ) {
    return `Show 1 to ${REPORT_LIMITS.rows} rows.`;
  }
  const ch = d.chart;
  if (ch !== undefined && ch !== null) {
    const c = ch as Record<string, unknown>;
    if (!REPORT_CHART_TYPES.includes(c.type as ReportChartType) || !keys.includes(c.x as string) || !keys.includes(c.y as string)) {
      return 'The chart needs two columns that are shown.';
    }
  }
  return null;
}

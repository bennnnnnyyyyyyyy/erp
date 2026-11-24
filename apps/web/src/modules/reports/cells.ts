import { formatMoney, type ReportCell, type ReportOutputType, type ReportResult, type ReportTotalFn } from '@erp/shared';
import { formatDay } from '../../lib/format';
import { tr, trf } from '../../lib/i18n';
import { formatQty } from '../../lib/numbers';
import { FN_LABELS, VALUE_LABELS, columnLabel } from './labels';

// Turning a report result into what people read (the table, the totals, the chart) and into the export (Excel keeps numbers numbers).

type DateFormat = { dateFormat: string } | null;

/**
 * A column heading: the column's name. A total in plain words (Ben, 24 Nov: "Sum of Total" was jargon): a sum is the column's name
 * ("Total", "Quantity"), a count is "Number of lines", the others "Average of Net".
 */
export function headerLabel(key: string, result?: Pick<ReportResult, 'totals'>): string {
  const t = result?.totals.find((x) => x.key === key);
  const m = t ? null : /^(sum|count|avg|min|max)_(.+)$/.exec(key);
  const fn = (t?.fn ?? m?.[1]) as ReportTotalFn | undefined;
  const column = t?.column ?? m?.[2];
  if (fn === 'sum' && column) return tr(columnLabel(column));
  if (fn === 'count') return tr('Number of lines');
  if (fn && column) return trf('{fn} of {column}', { fn: tr(FN_LABELS[fn]), column: tr(columnLabel(column)) });
  return tr(columnLabel(key));
}

/** One cell as text. Money is minor units and needs the row's currency (or the company currency when the column is not shown). */
export function cellText(v: ReportCell, type: ReportOutputType, key: string, currency: string | null, org: DateFormat): string {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'money') return currency ? formatMoney({ amountMinor: Math.round(Number(v)), currency }) : (Number(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
  if (type === 'number') return formatQty(Math.round(Number(v) * 100) / 100);
  if (type === 'date') return formatDay(String(v), org);
  const named = VALUE_LABELS[key]?.[String(v)];
  return named ? tr(named) : String(v);
}

/** One cell for Excel: numbers stay numbers (money in major units, its currency in its own column), dates stay YYYY-MM-DD. */
export function cellValue(v: ReportCell, type: ReportOutputType, key: string): string | number | null {
  if (v === null || v === undefined) return null;
  if (type === 'money') return Number(v) / 100;
  if (type === 'number') return Number(v);
  if (type === 'text') return VALUE_LABELS[key]?.[String(v)] ? tr(VALUE_LABELS[key][String(v)] as string) : String(v);
  return String(v);
}

/** The value a chart draws for a cell (money in major units). */
export const chartValue = (v: ReportCell, type: ReportOutputType): number => (type === 'money' ? Number(v ?? 0) / 100 : Number(v ?? 0));

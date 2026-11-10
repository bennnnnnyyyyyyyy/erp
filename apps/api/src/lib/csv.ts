import type { Context } from 'hono';
import { minorUnitsFor } from '@erp/shared';

/** One CSV cell: quoted when needed, and a leading =, +, - or @ in text is defused so a spreadsheet does not read it as a formula. */
export const csvCell = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  const safe = typeof v === 'string' && /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Exact decimal text of a minor-unit amount (no floating point), with the currency's own number of decimals. */
export const minorToText = (n: number, currency: string) => {
  const digits = minorUnitsFor(currency);
  const sign = n < 0 ? '-' : '';
  const a = String(Math.abs(n)).padStart(digits + 1, '0');
  return digits === 0 ? `${sign}${a}` : `${sign}${a.slice(0, -digits)}.${a.slice(-digits)}`;
};

/**
 * Plain CSV text for a spreadsheet that fetches it by address (Google Sheets IMPORTDATA): a header row, CRLF line ends, no byte-order
 * mark (it would stick to the first header). Cells are quoted when needed; text starting with = + - @ is defused like csvCell does.
 */
export const toCsv = (header: string[], rows: (string | number | null | undefined)[][]): string =>
  `${[header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n')}\r\n`;

/** A CSV download (UTF-8 with a byte-order mark, so Excel shows Arabic correctly). */
export function csvResponse(c: Context, filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const body = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n');
  return c.body(`﻿${body}\r\n`, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
  });
}

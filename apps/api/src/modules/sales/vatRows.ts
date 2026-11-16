// Invoice and note figures as stored by sql/086 (net, VAT, gross per line and per document). Rows read before that migration has run
// have no such columns: they are then computed the old way (net = round(qty x price), no VAT), so the screens keep working.

export type LineRow = {
  id?: string;
  invoice_id?: string;
  note_id?: string;
  order_line_id?: string;
  invoice_line_id?: string;
  qty: number | string;
  unit_price_minor: number | string;
  net_minor?: number | string | null;
  tax_minor?: number | string | null;
  tax_rate?: number | string | null;
  tax_rate_id?: string | null;
};

export type DocTotals = { netMinor: number; taxMinor: number; grossMinor: number };

export type LineOut = {
  qty: number;
  unitPriceMinor: number;
  taxRateId: string | null;
  /** Percentage, e.g. 14. */
  taxRate: number;
  netMinor: number;
  taxMinor: number;
  grossMinor: number;
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

export function lineOut(l: LineRow): LineOut {
  const qty = Number(l.qty);
  const unitPriceMinor = Number(l.unit_price_minor);
  const netMinor = num(l.net_minor) ?? Math.round(qty * unitPriceMinor);
  const taxMinor = num(l.tax_minor) ?? 0;
  return { qty, unitPriceMinor, taxRateId: l.tax_rate_id ?? null, taxRate: num(l.tax_rate) ?? 0, netMinor, taxMinor, grossMinor: netMinor + taxMinor };
}

/** The document's stored totals, else the sum of its lines (before sql/086). */
export function docTotals(row: Record<string, unknown>, lines: LineOut[]): DocTotals {
  const gross = num(row.gross_minor);
  if (gross !== null) {
    return { netMinor: num(row.net_minor) ?? gross, taxMinor: num(row.tax_minor) ?? 0, grossMinor: gross };
  }
  const netMinor = lines.reduce((n, l) => n + l.netMinor, 0);
  const taxMinor = lines.reduce((n, l) => n + l.taxMinor, 0);
  return { netMinor, taxMinor, grossMinor: netMinor + taxMinor };
}

/** A note's totals: stored by sql/086; before it, total_minor was the whole (zero-VAT) amount. */
export function noteTotals(row: Record<string, unknown>): DocTotals {
  const total = Number(row.total_minor ?? 0);
  const gross = num(row.gross_minor) ?? total;
  return { netMinor: num(row.net_minor) ?? gross, taxMinor: num(row.tax_minor) ?? 0, grossMinor: gross };
}

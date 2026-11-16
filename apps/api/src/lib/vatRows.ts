import { HttpError } from './errors';

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
  return {
    qty,
    unitPriceMinor,
    taxRateId: l.tax_rate_id ?? null,
    taxRate: num(l.tax_rate) ?? 0,
    netMinor,
    taxMinor,
    grossMinor: netMinor + taxMinor,
  };
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

// ---- supplier bills (sql/087): VAT as printed on the supplier's invoice; the computed VAT is kept beside it

export type BillRow = {
  id: string;
  number: string;
  supplier_id: string;
  order_id: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  created_at: string;
  net_minor?: number | string | null;
  line_tax_minor?: number | string | null;
  tax_minor?: number | string | null;
  gross_minor?: number | string | null;
  vat_deductible?: boolean | null;
  vat_class?: string | null;
  vat_document_ref?: string | null;
  supplier_tax_number?: string | null;
};
export type BillLineRow = {
  invoice_id: string;
  order_line_id: string;
  qty: number | string;
  unit_cost_minor: number | string;
  net_minor?: number | string | null;
  tax_minor?: number | string | null;
  tax_rate?: number | string | null;
  tax_rate_id?: string | null;
};
export type BillLineOut = {
  orderLineId: string;
  qty: number;
  unitCostMinor: number;
  taxRateId: string | null;
  taxRate: number;
  netMinor: number;
  taxMinor: number;
};

export function billLineOut(l: BillLineRow): BillLineOut {
  const qty = Number(l.qty);
  const unitCostMinor = Number(l.unit_cost_minor);
  return {
    orderLineId: l.order_line_id,
    qty,
    unitCostMinor,
    taxRateId: l.tax_rate_id ?? null,
    taxRate: num(l.tax_rate) ?? 0,
    netMinor: num(l.net_minor) ?? Math.round(qty * unitCostMinor),
    taxMinor: num(l.tax_minor) ?? 0,
  };
}

/** A bill's figures: stored by sql/087, else computed from its lines with no VAT. totalMinor is the gross (what is owed). */
export function billTotals(b: BillRow, lines: BillLineOut[]) {
  const stored = num(b.gross_minor);
  const netMinor = stored === null ? lines.reduce((n, l) => n + l.netMinor, 0) : (num(b.net_minor) ?? stored);
  const taxMinor = stored === null ? 0 : (num(b.tax_minor) ?? 0);
  const grossMinor = stored ?? netMinor;
  return {
    netMinor,
    taxMinor,
    /** VAT worked out from the lines; may differ from the printed VAT by a few piasters. */
    computedTaxMinor: num(b.line_tax_minor) ?? taxMinor,
    grossMinor,
    totalMinor: grossMinor,
    vatDeductible: b.vat_deductible === true,
    vatClass: b.vat_class ?? 'local',
    vatDocumentRef: b.vat_document_ref ?? null,
    supplierTaxNumber: b.supplier_tax_number ?? null,
  };
}

// ---- purchase VAT input (bills and expenses, sql/087)

export const VAT_CLASSES = ['local', 'capital', 'import'] as const;
export type PurchaseVatInput = {
  taxMinor?: number;
  taxRateId?: string;
  deductible?: boolean;
  documentRef?: string;
  vatClass?: (typeof VAT_CLASSES)[number];
  supplierTaxNumber?: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks the optional `vat` object of a bill or expense; the database checks again (registration, tolerance, references). */
export function parsePurchaseVat(raw: unknown): PurchaseVatInput | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'vat must be an object', 'invalid_input');
  const v = raw as Record<string, unknown>;
  const out: PurchaseVatInput = {};
  if (v.taxMinor !== undefined && v.taxMinor !== null) {
    if (typeof v.taxMinor !== 'number' || !Number.isInteger(v.taxMinor) || v.taxMinor < 0)
      throw new HttpError(400, 'The VAT must be a whole number of minor units, zero or more', 'invalid_input');
    out.taxMinor = v.taxMinor;
  }
  if (v.taxRateId !== undefined && v.taxRateId !== null && v.taxRateId !== '') {
    if (typeof v.taxRateId !== 'string' || !UUID.test(v.taxRateId))
      throw new HttpError(400, 'taxRateId must be a tax rate id', 'invalid_input');
    out.taxRateId = v.taxRateId;
  }
  if (v.deductible !== undefined && v.deductible !== null) {
    if (typeof v.deductible !== 'boolean') throw new HttpError(400, 'deductible must be true or false', 'invalid_input');
    out.deductible = v.deductible;
  }
  for (const k of ['documentRef', 'supplierTaxNumber'] as const) {
    const s = typeof v[k] === 'string' ? (v[k] as string).trim() : '';
    if (s.length > (k === 'documentRef' ? 100 : 50)) throw new HttpError(400, `${k} is too long`, 'invalid_input');
    if (s) out[k] = s;
  }
  if (v.vatClass !== undefined && v.vatClass !== null && v.vatClass !== '') {
    if (!(VAT_CLASSES as readonly unknown[]).includes(v.vatClass))
      throw new HttpError(400, 'vatClass must be local, capital or import', 'invalid_input');
    out.vatClass = v.vatClass as PurchaseVatInput['vatClass'];
  }
  return Object.keys(out).length ? out : null;
}

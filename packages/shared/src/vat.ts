// VAT on document lines (documentation/plans/VAT_PLAN.md, sql/086). The database computes and stores these figures; this is the same
// rule for screens that preview a line before it is saved. Prices are before VAT. Amounts are integer minor units.

/** Round half away from zero (as Postgres numeric round() and ETA documents do). */
function roundHalfAway(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

export type VatLine = { netMinor: number; taxMinor: number; grossMinor: number };

/** One line: net = round(qty x unit price); tax = round(net x rate / 100); gross = net + tax. Rate is a percentage, e.g. 14. */
export function vatLine(qty: number, unitPriceMinor: number, ratePercent: number): VatLine {
  // qty has up to 3 decimals and rates up to 5: scale to integers first so 1.005 x 200 is not 200.99999.
  const netMinor = roundHalfAway(Math.round(qty * 1000 * unitPriceMinor) / 1000);
  const taxMinor = roundHalfAway(Math.round(netMinor * ratePercent * 100000) / 100000 / 100);
  return { netMinor, taxMinor, grossMinor: netMinor + taxMinor };
}

/** GET /v1/core/org/vat: the company's VAT setting and its VAT (ETA type T1) rates. */
export type VatSettings = {
  vatRegistered: boolean;
  defaultVatRateId: string | null;
  /** The first day VAT applies (sql/087): set when VAT is first switched on. Optional while an older API answers. */
  vatFrom?: string | null;
  rates: { id: string; subType: string; rate: number; label: string; isDefault: boolean }[];
};

/** A document's totals: the sums of its lines. */
export function vatTotals(lines: readonly VatLine[]): VatLine {
  return lines.reduce(
    (t, l) => ({ netMinor: t.netMinor + l.netMinor, taxMinor: t.taxMinor + l.taxMinor, grossMinor: t.grossMinor + l.grossMinor }),
    { netMinor: 0, taxMinor: 0, grossMinor: 0 },
  );
}

/** What a customer owes on an invoice before payments: gross - approved credit notes + approved debit notes. */
export function invoiceDueMinor(grossMinor: number, creditedMinor: number, debitedMinor: number): number {
  return grossMinor - creditedMinor + debitedMinor;
}

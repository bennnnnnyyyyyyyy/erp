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
  /** The ETA VAT sub-types a rate can carry (V001 export, V003 exempt, V009 general, …). Optional while an older API answers. */
  subTypes?: { code: string; description: string }[];
  /** sql/091 (optional while an older API answers). */
  returnDueDays?: number | null;
  smallEnterprise?: boolean;
  openingEntered?: boolean;
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

/** GET /v1/finance/vat-summary (sql/089): the VAT position for a period, laid out like the return. Amounts in minor units. */
export type VatSummary = {
  from: string;
  to: string;
  currency: string;
  vatRegistered: boolean;
  vatFrom: string | null;
  /** taxable (per rate), zero_rated (export, ETA V001/V002), exempt; notes are approved credit (negative) and debit notes. */
  sales: {
    kind: 'taxable' | 'zero_rated' | 'exempt';
    rate: number;
    invoicesNetMinor: number;
    invoicesTaxMinor: number;
    notesNetMinor: number;
    notesTaxMinor: number;
    netMinor: number;
    taxMinor: number;
  }[];
  /** By kind of purchase: local goods and services, capital assets, imports. */
  purchases: { kind: 'local' | 'capital' | 'import'; netMinor: number; deductibleTaxMinor: number; nonDeductibleTaxMinor: number }[];
  outputTaxMinor: number;
  inputTaxMinor: number;
  /** Output VAT less deductible input VAT: positive is owed, negative is a credit to carry forward. */
  dueMinor: number;
  warnings: ('not_registered' | 'before_vat_from' | 'partial_deduction' | 'other_currency' | 'excludes_supplier_credit_notes')[];
  otherCurrencyDocuments: number;
  documents: {
    type: 'customer_invoice' | 'sales_note' | 'supplier_invoice' | 'expense';
    id: string;
    number: string;
    date: string;
    side: 'sales' | 'purchases';
    kind: string;
    rate: number;
    netMinor: number;
    taxMinor: number;
    nonDeductibleTaxMinor: number;
  }[];
};

/** GET /v1/accounting/vat-months/:month (sql/091): a VAT month from the ledger, its close and payments, refunds and the deadline. */
export type VatMonth = {
  month: string;
  end: string;
  currency: string;
  ended: boolean;
  ledgerOutputMinor: number;
  ledgerInputMinor: number;
  ledgerDueMinor: number;
  /** From the document summary (part 3); null when the reader may not see it. */
  summaryDueMinor: number | null;
  differenceMinor: number | null;
  period: {
    id: string;
    journalId: string;
    journalStatus: 'draft' | 'posted' | 'rejected' | 'cancelled';
    outputMinor: number;
    inputMinor: number;
    dueMinor: number;
    paidMinor: number;
    leftMinor: number;
  } | null;
  creditStreak: number;
  smallEnterprise: boolean;
  refundAvailable: boolean;
  returnDueOn: string;
  returnDueDays: number | null;
};

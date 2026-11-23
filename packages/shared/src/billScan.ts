// Scanning supplier bills (sql/108, SCANNING_PLAN.md step 1). The AI only reads; our own code (apps/api/src/modules/purchasing/billMatch.ts)
// matches the supplier, the received order and the lines, and a person checks the draft and saves it through the normal bill function.

/** What the AI read from the bill. Amounts are as printed (major units, for example 1140.50), not minor units. */
export type ScannedBillLine = {
  description: string;
  itemCode: string | null;
  qty: number | null;
  unitPrice: number | null;
  /** VAT percent printed on the line, for example 14. */
  vatRate: number | null;
  lineTotal: number | null;
};
export type ScannedBill = {
  supplierName: string | null;
  supplierTaxNumber: string | null;
  billNumber: string | null;
  /** YYYY-MM-DD */
  billDate: string | null;
  currency: string | null;
  /** Our purchase order number, when the bill prints it. */
  orderRef: string | null;
  lines: ScannedBillLine[];
  netTotal: number | null;
  vatTotal: number | null;
  grandTotal: number | null;
};

const nul = (type: string) => ({ anyOf: [{ type }, { type: 'null' }] });

/** The fixed shape every provider must answer in (strict: every field present, null when not printed). */
export const SCANNED_BILL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'supplierName',
    'supplierTaxNumber',
    'billNumber',
    'billDate',
    'currency',
    'orderRef',
    'lines',
    'netTotal',
    'vatTotal',
    'grandTotal',
  ],
  properties: {
    supplierName: nul('string'),
    supplierTaxNumber: nul('string'),
    billNumber: nul('string'),
    billDate: nul('string'),
    currency: nul('string'),
    orderRef: nul('string'),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'itemCode', 'qty', 'unitPrice', 'vatRate', 'lineTotal'],
        properties: {
          description: { type: 'string' },
          itemCode: nul('string'),
          qty: nul('number'),
          unitPrice: nul('number'),
          vatRate: nul('number'),
          lineTotal: nul('number'),
        },
      },
    },
    netTotal: nul('number'),
    vatTotal: nul('number'),
    grandTotal: nul('number'),
  },
} as const;

export const SCANNED_BILL_INSTRUCTIONS = [
  'This is a supplier bill (a purchase invoice), in Arabic, English or both.',
  'Copy what is printed. Never guess, never calculate a value that is not printed, and use null for anything not printed or not readable.',
  "supplierName: the company that sends the bill (the seller), not the buyer. supplierTaxNumber: the seller's tax registration number.",
  "billNumber: the seller's invoice number. billDate: the invoice date as YYYY-MM-DD. currency: the ISO 4217 code, for example EGP.",
  "orderRef: the buyer's purchase order number, only if printed (for example PO-0042).",
  'lines: one entry per product line, in printed order. itemCode: the product code printed on the line. qty, unitPrice, lineTotal: numbers',
  'without thousands separators (Arabic-Indic digits become 0-9). vatRate: the VAT percent of the line, for example 14.',
  'netTotal: total before VAT. vatTotal: total VAT. grandTotal: total to pay.',
].join('\n');

/** A difference or a problem found by our matching. `text` is English with {placeholders} (translated on the screen). */
export type BillWarning = { code: string; text: string; values?: Record<string, string | number> };

export type BillScanOrderLine = {
  orderLineId: string;
  itemId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  supplierCode: string | null;
  unit: string | null;
  unitFactor: number | null;
  receivedQty: number;
  billedQty: number;
  /** Price per base unit on the order (the bill is saved at this price). */
  unitCostMinor: number;
  vatRate: number | null;
};

export type BillScanLine = {
  /** Position of the line on the bill. */
  index: number;
  line: ScannedBillLine;
  orderLineId: string | null;
  how: 'supplier_code' | 'item_code' | 'name' | null;
  /** Quantity in the item's base unit (the bill's quantity times the order line's unit factor), or null. */
  qty: number | null;
  warnings: BillWarning[];
};

export type BillScanResult = {
  extractionId: string | null;
  provider: string;
  model: string;
  file: { sha256: string; mime: string; bytes: number };
  bill: ScannedBill;
  supplier: { id: string; name: string; how: 'tax' | 'name' } | null;
  suppliers: { id: string; name: string; taxNumber: string | null }[];
  order: { id: string; number: string; currency: string } | null;
  orders: { id: string; number: string }[];
  /** Orders of this supplier whose goods have not arrived: the bill cannot be saved yet; receive the goods first. */
  waitingOrders: { id: string; number: string }[];
  orderLines: BillScanOrderLine[];
  lines: BillScanLine[];
  warnings: BillWarning[];
  /** What the screen fills in; the person changes it and saves with POST /v1/purchasing/supplier-invoices. */
  draft: {
    supplierId: string | null;
    orderId: string | null;
    number: string;
    invoiceDate: string;
    taxMinor: number | null;
    lines: { orderLineId: string; qty: number }[];
  };
};

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BillScanOrderLine } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { sniffMime } from '../src/lib/uploads';
import { buildDraft, type Candidates, nameScore, normalizeScannedBill, num, pickSupplier } from '../src/modules/purchasing/billMatch';

// Scanning supplier bills (sql/108, step 1): our matching, from a recorded AI answer. No AI and no database are called.

const line = (o: Partial<BillScanOrderLine> & { orderLineId: string; sku: string; name: string }): BillScanOrderLine => ({
  itemId: `item-${o.orderLineId}`,
  nameAr: null,
  supplierCode: null,
  unit: null,
  unitFactor: null,
  receivedQty: 10,
  billedQty: 0,
  unitCostMinor: 50000,
  vatRate: 14,
  ...o,
});

/** A recorded answer from a provider for the plan's example: Nile Chemicals, 3 lines, VAT 14%, line 2 at 520 against 500. */
const recorded = {
  supplierName: 'شركة النيل للكيماويات Nile Chemicals',
  supplierTaxNumber: '100-200-300',
  billNumber: 'NC-1001',
  billDate: '2026-11-20',
  currency: 'EGP',
  orderRef: null,
  lines: [
    { description: 'Soda caustic', itemCode: 'NC-77', qty: 10, unitPrice: 500, vatRate: 14, lineTotal: 5000 },
    { description: 'حمض الستريك Citric acid', itemCode: null, qty: '4', unitPrice: '520.00', vatRate: 14, lineTotal: 2080 },
    { description: 'Delivery', itemCode: null, qty: 1, unitPrice: 0, vatRate: null, lineTotal: 0 },
  ],
  netTotal: '7,080.00',
  vatTotal: 991.2,
  grandTotal: 8071.2,
};

const candidates = (over: Partial<Candidates> = {}): Candidates => ({
  suppliers: [{ id: 'sup-1', name: 'Nile Chemicals', taxNumber: '100200300', how: 'tax' }],
  supplierId: 'sup-1',
  receivedOrders: [
    {
      id: 'po-42',
      number: 'PO-0042',
      currency: 'EGP',
      lines: [
        line({ orderLineId: 'ol-1', sku: 'CH-1', name: 'Caustic soda 25kg', supplierCode: 'NC-77' }),
        line({ orderLineId: 'ol-2', sku: 'CH-2', name: 'Citric acid', nameAr: 'حمض الستريك', receivedQty: 4 }),
      ],
    },
  ],
  waitingOrders: [],
  ...over,
});

describe('cleaning what the AI read', () => {
  it('numbers as printed, in any digits', () => {
    expect(num('7,080.00')).toBe(7080);
    expect(num('١٬١٤٠٫٥٠')).toBe(1140.5);
    expect(num('EGP 12')).toBe(12);
    expect(num('twelve')).toBeNull();
    expect(num(Number.NaN)).toBeNull();
  });
  it('wrong or missing fields become null; bad dates are dropped; at most 200 lines', () => {
    const b = normalizeScannedBill({ billDate: '2026-02-30', currency: 'pounds', lines: Array(300).fill({ description: 'x' }), extra: 1 });
    expect(b.billDate).toBeNull();
    expect(b.currency).toBeNull();
    expect(b.lines).toHaveLength(200);
    expect(normalizeScannedBill('not an object').lines).toEqual([]);
  });
});

describe('names', () => {
  it('Arabic letter forms and company words do not stop a match', () => {
    expect(nameScore('شركة النيل للكيماويات', 'النيل للكيماويات')).toBe(1);
    expect(nameScore('Nile Chemicals Co.', 'NILE CHEMICALS')).toBe(1);
    expect(nameScore('أحمد', 'احمد')).toBe(1);
    expect(nameScore('Delta Paper', 'Nile Chemicals')).toBe(0);
  });
  it('the supplier by tax number first, else by name above 0.6', () => {
    const bill = normalizeScannedBill(recorded);
    expect(pickSupplier(bill, candidates())).toEqual({ id: 'sup-1', how: 'tax' });
    const byName = candidates({ suppliers: [{ id: 'sup-1', name: 'Nile Chemicals', taxNumber: null, how: 'name' }], supplierId: null });
    expect(pickSupplier(bill, byName)).toEqual({ id: 'sup-1', how: 'name' });
    const none = candidates({ suppliers: [{ id: 's9', name: 'Delta Paper', taxNumber: null, how: 'name' }], supplierId: null });
    expect(pickSupplier(bill, none)).toBeNull();
  });
});

describe('the draft (the plan example)', () => {
  const bill = normalizeScannedBill(recorded);
  const d = buildDraft(bill, candidates(), { id: 'sup-1', how: 'tax' });

  it('matches the order and each line: supplier code, then name (Arabic or English)', () => {
    expect(d.order?.number).toBe('PO-0042');
    expect(d.lines.map((l) => [l.orderLineId, l.how])).toEqual([
      ['ol-1', 'supplier_code'],
      ['ol-2', 'name'],
      [null, null],
    ]);
    expect(d.draft).toMatchObject({ supplierId: 'sup-1', orderId: 'po-42', number: 'NC-1001', invoiceDate: '2026-11-20', taxMinor: 99120 });
    expect(d.draft.lines).toEqual([
      { orderLineId: 'ol-1', qty: 10 },
      { orderLineId: 'ol-2', qty: 4 },
    ]);
  });
  it('shows the price difference and says the order price is kept', () => {
    const w = d.lines[1]?.warnings.find((x) => x.code === 'price_differs');
    expect(w?.values).toMatchObject({ diff: expect.stringContaining('+') });
    expect(w?.text).toContain('saved at the order price');
    expect(d.lines[0]?.warnings).toEqual([]);
    expect(d.lines[2]?.warnings.map((x) => x.code)).toEqual(['line_not_on_order']);
  });
  it('printed totals are checked, never changed', () => {
    expect(d.warnings.map((w) => w.code)).not.toContain('lines_not_net');
    const bad = buildDraft({ ...bill, grandTotal: 9000 }, candidates(), { id: 'sup-1', how: 'tax' });
    expect(bad.warnings.map((w) => w.code)).toContain('total_mismatch');
    expect(bad.draft.taxMinor).toBe(99120);
  });
});

describe('quantities, units and VAT', () => {
  const one = (qty: number, o: Partial<BillScanOrderLine> = {}, l: Record<string, unknown> = {}) =>
    buildDraft(
      normalizeScannedBill({ ...recorded, lines: [{ description: 'Soda', itemCode: 'CH-1', qty, unitPrice: 500, vatRate: 14, ...l }] }),
      candidates({
        receivedOrders: [
          { id: 'po-42', number: 'PO-0042', currency: 'EGP', lines: [line({ orderLineId: 'ol-1', sku: 'CH-1', name: 'Soda', ...o })] },
        ],
      }),
      { id: 'sup-1', how: 'tax' },
    );
  it('more than received and not billed: capped, with a warning', () => {
    const d = one(15, { billedQty: 2 });
    expect(d.lines[0]?.how).toBe('item_code');
    expect(d.lines[0]?.qty).toBe(8);
    expect(d.lines[0]?.warnings.map((w) => w.code)).toEqual(['qty_over']);
  });
  it('less than received: kept, with a note', () => {
    expect(one(6).lines[0]?.warnings.map((w) => w.code)).toEqual(['qty_less']);
  });
  it('a box of 12 on the order: the bill quantity is boxes, the price per box', () => {
    const d = one(2, { unit: 'box', unitFactor: 12, receivedQty: 24, unitCostMinor: 5000 }, { unitPrice: 600 });
    expect(d.lines[0]?.qty).toBe(24);
    expect(d.lines[0]?.warnings).toEqual([]);
  });
  it('a different VAT rate is shown', () => {
    expect(one(10, {}, { vatRate: 5 }).lines[0]?.warnings.map((w) => w.code)).toEqual(['vat_differs']);
  });
  it('an order line missing from the bill is listed', () => {
    const d = buildDraft(normalizeScannedBill({ ...recorded, lines: [recorded.lines[0]] }), candidates(), { id: 'sup-1', how: 'tax' });
    expect(d.warnings.map((w) => w.code)).toContain('not_on_bill');
  });
});

describe('no received goods (Ben, 23 Nov: refuse, offer the receipt)', () => {
  it('a blocking warning and the orders waiting for goods; nothing to save', () => {
    const d = buildDraft(
      normalizeScannedBill(recorded),
      candidates({ receivedOrders: [], waitingOrders: [{ id: 'po-50', number: 'PO-0050' }] }),
      { id: 'sup-1', how: 'tax' },
    );
    expect(d.warnings.map((w) => w.code)).toContain('no_received_order');
    expect(d.waitingOrders).toEqual([{ id: 'po-50', number: 'PO-0050' }]);
    expect(d.draft.orderId).toBeNull();
    expect(d.draft.lines).toEqual([]);
  });
  it('an unknown supplier is a warning, never a new supplier', () => {
    const d = buildDraft(normalizeScannedBill(recorded), candidates({ suppliers: [], supplierId: null }), null);
    expect(d.warnings.map((w) => w.code)).toEqual(['supplier_not_found']);
    expect(d.draft.supplierId).toBeNull();
  });
  it('the order the bill names wins', () => {
    const two = candidates();
    two.receivedOrders.push({ id: 'po-7', number: 'PO-0007', currency: 'EGP', lines: [] });
    expect(buildDraft(normalizeScannedBill({ ...recorded, orderRef: 'PO-7' }), two, { id: 'sup-1', how: 'tax' }).order?.id).toBe('po-7');
  });
});

describe('files', () => {
  it('the first bytes decide the type, not the name', () => {
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer)).toBe('image/jpeg');
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]).buffer)).toBe('image/png');
    expect(sniffMime(new TextEncoder().encode('RIFF1234WEBPVP8 ').buffer as ArrayBuffer)).toBe('image/webp');
    expect(sniffMime(new TextEncoder().encode('%PDF-1.7').buffer as ArrayBuffer)).toBe('application/pdf');
    expect(sniffMime(new TextEncoder().encode('<html>').buffer as ArrayBuffer)).toBeNull();
  });
});

describe('the scan and attachment routes (source guards)', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');
  it('the AI never saves: the scan route does not record a bill, and neither route uses the secret-key client', () => {
    const scan = src('modules/purchasing/billScan.ts');
    expect(scan).not.toMatch(/['"]pur_record_supplier_invoice['"]|supplier-invoices['"]/);
    expect(scan).not.toMatch(/db\.admin|adminDb/);
    expect(src('modules/core/attachmentRoutes.ts')).not.toMatch(/db\.admin|adminDb/);
  });
  it('the scan asks the database before spending AI money', () => {
    const scan = src('modules/purchasing/billScan.ts');
    expect(scan.indexOf('await candidates(c, null, null, null)')).toBeGreaterThan(0);
    expect(scan.indexOf('await candidates(c, null, null, null)')).toBeLessThan(scan.indexOf('readWithAi(c.env'));
  });
});

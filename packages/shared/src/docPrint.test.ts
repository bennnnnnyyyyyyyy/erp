import { describe, expect, it } from 'vitest';
import { etaForPrint, formatAmount, formatQty, isDraftPrint, toArabicDigits, type DocPrintData } from './docPrint';

describe('amounts and digits on printouts', () => {
  it('formats minor units exactly, with thousands', () => {
    expect(formatAmount(123456, 'EGP')).toBe('1,234.56');
    expect(formatAmount(5, 'EGP')).toBe('0.05');
    expect(formatAmount(-100000, 'EGP')).toBe('-1,000.00');
    expect(formatAmount(500, 'JPY')).toBe('500');
    expect(formatAmount(9007199254740993n, 'EGP')).toBe('90,071,992,547,409.93');
  });
  it('writes Arabic-Indic digits when the company chose them', () => {
    expect(formatAmount(123456, 'EGP', 'arab')).toBe('١٬٢٣٤٫٥٦');
    expect(toArabicDigits('INV-2026-00001')).toBe('INV-٢٠٢٦-٠٠٠٠١');
    expect(formatQty(2.5, 'arab')).toBe('٢٫٥');
    expect(formatQty(3)).toBe('3');
  });
});

const base = (over: Partial<DocPrintData['document']> = {}): DocPrintData => ({
  document: {
    type: 'invoice',
    kind: 'invoice',
    id: 'x',
    number: 'INV-2026-00001',
    status: 'issued',
    date: '2026-11-23',
    dueDate: null,
    currency: 'EGP',
    netMinor: 100000,
    taxMinor: 14000,
    grossMinor: 114000,
    issuedAt: '2026-11-23T10:00:00Z',
    orderNumber: null,
    invoiceNumber: null,
    reason: null,
    ...over,
  },
  lines: [
    {
      itemId: 'i',
      sku: 'A',
      name: 'Item A',
      uom: 'piece',
      qty: 10,
      unit: null,
      unitFactor: null,
      unitPriceMinor: 10000,
      priceIncludesVat: false,
      taxRate: 14,
      netMinor: 100000,
      taxMinor: 14000,
      taxType: 'T1',
      taxSubType: 'V009',
      etaItemType: 'EGS',
      etaItemCode: 'EG-123456789-1',
      etaUnitCode: 'EA',
    },
  ],
  customer: {
    name: 'Buyer',
    contact: null,
    city: null,
    phone: null,
    code: null,
    taxIdType: 'B',
    taxId: '123456789',
    country: 'EG',
    governate: 'Cairo',
    regionCity: 'Nasr City',
    street: 'Main',
    buildingNumber: '1',
  },
  company: {
    name: 'Seller',
    legalName: 'Seller SAE',
    taxNumber: '987654321',
    activityCode: '4620',
    vatRegistered: true,
    branch: {
      code: '0',
      name: 'HQ',
      country: 'EG',
      governate: 'Cairo',
      regionCity: 'Cairo',
      street: 'Tahrir',
      buildingNumber: '5',
      postalCode: null,
    },
  },
  settings: {
    logo: null,
    letterhead: null,
    marginTopMm: 40,
    marginBottomMm: 30,
    headerText: null,
    footerText: null,
    bankDetails: null,
    paymentTerms: null,
    language: 'ar',
    digits: 'latn',
    layout: 'eta',
  },
});

describe('DRAFT mark', () => {
  it('marks drafts and notes that are not approved, never an issued invoice', () => {
    expect(isDraftPrint({ ...base().document, type: 'draft', status: 'draft' })).toBe(true);
    expect(isDraftPrint({ ...base().document, type: 'note', kind: 'credit', status: 'submitted' })).toBe(true);
    expect(isDraftPrint({ ...base().document, type: 'note', kind: 'credit', status: 'approved' })).toBe(false);
    expect(isDraftPrint(base().document)).toBe(false);
  });
});

describe('ETA layout uses the ETA builder', () => {
  it('gives the same totals as the stored invoice for a plain VAT invoice', () => {
    const r = etaForPrint(base());
    expect(r.issues).toEqual([]);
    expect(r.built?.totals.totalAmount).toBe(1140_00000n);
    expect(r.built?.totals.netAmount).toBe(1000_00000n);
  });
  it('lists what is missing instead of printing', () => {
    const d = base();
    d.company.taxNumber = null;
    d.lines[0]!.etaItemCode = null;
    const r = etaForPrint(d);
    expect(r.built).toBeNull();
    expect(r.issues.map((i) => i.code)).toContain('COMPANY_TAX_NUMBER');
    const d2 = base();
    d2.lines[0]!.etaItemCode = null;
    expect(etaForPrint(d2).issues.map((i) => i.code)).toContain('ITEM_CODE');
  });
});

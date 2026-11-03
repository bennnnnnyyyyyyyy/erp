/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  StubSigner,
  buildDocument,
  calcLine,
  calcTotals,
  canonicalize,
  documentDigest,
  documentJson,
  fmtDec,
  mul,
  num,
  parseDec,
  parseDoc,
  pct,
  signDocument,
  stringifyDoc,
  toEtaInput,
  toHex,
  utf8,
  validateInput,
  validateNote,
  webCryptoSha256,
  type DocObject,
  type EtaDocInput,
  type LineInput,
} from './index';

// Official sample (SDK "one-doc.json"): used as a test vector when the offline SDK copy is present.
const SDK_DIR = process.env.ETA_SDK_DIR ?? join(process.cwd(), '../../documentation/reference/eta-sdk/2026-11-02/files/files');
const haveSdk = existsSync(join(SDK_DIR, 'one-doc.json'));

describe('decimal', () => {
  it('parses and formats exactly', () => {
    expect(fmtDec(parseDec('189.4'))).toBe('189.40');
    expect(fmtDec(parseDec('1.21984'))).toBe('1.21984');
    expect(fmtDec(parseDec('5'))).toBe('5.00');
    expect(fmtDec(parseDec('-7.5'))).toBe('-7.50');
    expect(() => parseDec('1.123456')).toThrow('INVALID_DECIMAL');
    expect(() => parseDec('abc')).toThrow('INVALID_DECIMAL');
  });
  it('rounds half away from zero at 5 decimals', () => {
    expect(fmtDec(mul(parseDec('0.00001'), parseDec('0.5')))).toBe('0.00001'); // 0.000005 -> 0.00001
    expect(fmtDec(mul(parseDec('-0.00001'), parseDec('0.5')))).toBe('-0.00001');
    expect(fmtDec(pct(parseDec('1943.35'), parseDec('14')))).toBe('272.069'); // 272.0690 exactly at 5 places
  });
});

describe('raw json', () => {
  it('keeps number text and property order', () => {
    const src = '{"b":10.50,"a":[0.0,1,"x"],"c":{"z":12}}';
    const v = parseDoc(src);
    expect(stringifyDoc(v)).toBe(src);
  });
  it('rejects bad input', () => {
    expect(() => parseDoc('{"a":}')).toThrow('JSON_PARSE');
    expect(() => parseDoc('{"a":1} x')).toThrow('JSON_PARSE');
  });
});

describe('canonical serialization', () => {
  it('upper-cases names, quotes values, repeats array names, keeps number text', () => {
    const doc = parseDoc('{"a":{"b":"x","n":10.50},"items":[{"q":1},{"q":2.0}],"refs":["u1","u2"],"signatures":[{"v":"s"}]}') as DocObject;
    expect(canonicalize(doc)).toBe(
      '"A""B""x""N""10.50"' + '"ITEMS""ITEMS""Q""1""ITEMS""Q""2.0"' + '"REFS""REFS""u1""REFS""u2"',
    );
  });
  it('ignores signatures', () => {
    const a = parseDoc('{"a":"1"}') as DocObject;
    const b = parseDoc('{"a":"1","signatures":[{"signatureType":"I","value":"zzz"}]}') as DocObject;
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
  it('hashes with SHA-256 (known vector)', async () => {
    expect(toHex(await webCryptoSha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it.skipIf(!haveSdk)('matches the SDK sample byte for byte (one-doc.json -> one-doc-serialized.json.txt)', () => {
    const doc = parseDoc(readFileSync(join(SDK_DIR, 'one-doc.json'), 'utf8')) as DocObject;
    const expected = readFileSync(join(SDK_DIR, 'one-doc-serialized.json.txt'), 'utf8').replace(/\r?\n$/, '');
    expect(canonicalize(doc)).toBe(expected);
  });
});

// The SDK sample's two lines, as inputs. The expected figures are the sample's own stated amounts, which ETA's equations
// must reproduce (offline copy: files/files/one-doc.json).
const sampleTaxes = (rates: Record<string, string>, fixed: Record<string, string>) =>
  Array.from({ length: 20 }, (_, i) => {
    const t = `T${i + 1}`;
    return fixed[t] !== undefined ? { taxType: t, subType: t, amount: fixed[t] } : { taxType: t, subType: t, rate: rates[t] ?? '0' };
  });
const RATES = { T1: '14', T2: '12', T4: '5', T5: '14', T7: '10', T8: '14', T9: '12', T10: '10', T11: '14', T12: '12', T13: '10', T14: '14', T15: '12', T16: '10', T17: '10', T18: '14', T19: '12', T20: '10' };
const sampleLine1: LineInput = {
  description: 'Computer1', itemType: 'GS1', itemCode: '10001774', unitType: 'EA', quantity: '5', unitPriceEGP: '189.40',
  discountRate: '7', itemsDiscount: '5', valueDifference: '7', taxes: sampleTaxes(RATES, { T3: '30', T6: '60' }),
};
const sampleLine2: LineInput = {
  description: 'Computer2', itemType: 'GS1', itemCode: '10003752', unitType: 'EA', quantity: '7', unitPriceEGP: '94.70',
  discountAmount: '10', itemsDiscount: '9', valueDifference: '6', taxes: sampleTaxes(RATES, { T3: '30', T6: '60' }),
};

describe('line and document arithmetic reproduces ETA equations (SDK sample)', () => {
  const l1 = calcLine(sampleLine1);
  const l2 = calcLine(sampleLine2);
  const f = (v: bigint) => fmtDec(v);
  it('line 1 matches the sample', () => {
    expect(f(l1.salesTotal)).toBe('947.00');
    expect(f(l1.discountAmount)).toBe('66.29');
    expect(f(l1.netTotal)).toBe('880.71');
    expect(f(l1.totalTaxableFees)).toBe('817.42');
    const by = Object.fromEntries(l1.taxes.map((t) => [t.taxType, f(t.amount)]));
    expect(by.T1).toBe('272.07');
    expect(by.T2).toBe('208.22');
    expect(by.T4).toBe('43.79');
    expect(by.T5).toBe('123.30');
    expect(by.T9).toBe('105.69');
    expect(by.T20).toBe('88.07');
    expect(f(l1.total)).toBe('2969.89');
  });
  it('line 2 matches the sample', () => {
    expect(f(l2.salesTotal)).toBe('662.90');
    expect(f(l2.netTotal)).toBe('652.90');
    expect(f(l2.totalTaxableFees)).toBe('621.51');
    expect(f(l2.taxes.find((t) => t.taxType === 'T1')!.amount)).toBe('205.47');
    expect(f(l2.taxes.find((t) => t.taxType === 'T2')!.amount)).toBe('157.25');
    expect(f(l2.total)).toBe('2226.61');
  });
  it('document totals match the sample', () => {
    const t = calcTotals([l1, l2], parseDec('5'));
    expect(f(t.totalSalesAmount)).toBe('1609.90');
    expect(f(t.totalDiscountAmount)).toBe('76.29');
    expect(f(t.netAmount)).toBe('1533.61');
    expect(f(t.totalItemsDiscountAmount)).toBe('14.00');
    expect(f(t.totalAmount)).toBe('5191.50');
    const by = Object.fromEntries(t.taxTotals.map((x) => [x.taxType, f(x.amount)]));
    expect(by.T1).toBe('477.54');
    expect(by.T2).toBe('365.47');
    expect(by.T4).toBe('75.99');
    expect(by.T20).toBe('153.36');
    expect(t.taxTotals.map((x) => x.taxType)).toEqual(Array.from({ length: 20 }, (_, i) => `T${i + 1}`));
  });
  it('rejects bad lines', () => {
    expect(() => calcLine({ ...sampleLine1, quantity: '0' })).toThrow('INVALID_QUANTITY');
    expect(() => calcLine({ ...sampleLine1, taxes: [...sampleLine1.taxes, { taxType: 'T1', subType: 'V009', rate: '14' }] })).toThrow('DUPLICATE_TAX_TYPE');
    expect(() => calcLine({ ...sampleLine1, taxes: [{ taxType: 'T3', subType: 'Tbl02', rate: '5' }] })).toThrow('FIXED_AMOUNT_REQUIRED');
    expect(() => calcLine({ ...sampleLine1, discountAmount: '1' })).toThrow('DISCOUNT_MISMATCH');
    expect(() => calcLine({ ...sampleLine1, discountRate: '0', discountAmount: '99999' })).toThrow('INVALID_DISCOUNT');
  });
});

const baseInput = (over: Partial<EtaDocInput> = {}): EtaDocInput => ({
  kind: 'invoice',
  version: '1.0',
  issuer: {
    id: '100200300', name: 'Test Seller LLC', branchId: '0',
    address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: '1 Test St', buildingNumber: '1' },
  },
  receiver: {
    type: 'B', id: '200300400', name: 'Test Buyer LLC',
    address: { country: 'EG', governate: 'Giza', regionCity: 'Dokki', street: '2 Test St', buildingNumber: '2' },
  },
  dateTimeIssued: '2026-11-02T10:15:00Z',
  taxpayerActivityCode: '4620',
  internalId: 'INV-0001',
  lines: [
    { description: 'Face cream 50ml', itemType: 'EGS', itemCode: 'EG-100200300-FC50', unitType: 'EA', quantity: '10', unitPriceEGP: '125.50', taxes: [{ taxType: 'T1', subType: 'V009', rate: '14' }] },
    { description: 'Consulting', itemType: 'EGS', itemCode: 'EG-100200300-SVC', unitType: 'EA', quantity: '1', unitPriceEGP: '1000', discountRate: '10', taxes: [{ taxType: 'T1', subType: 'V009', rate: '14' }, { taxType: 'T4', subType: 'W004', rate: '5' }] },
  ],
  ...over,
});

describe('buildDocument', () => {
  it('builds an invoice with exact amounts', () => {
    const { doc, totals } = buildDocument(baseInput());
    // line 1: 10 * 125.50 = 1255.00, VAT 14% = 175.70, total 1430.70
    // line 2: 1000, discount 100, net 900, VAT 126, withholding 5% of 900 = 45, total 981
    expect(fmtDec(totals.totalSalesAmount)).toBe('2255.00');
    expect(fmtDec(totals.totalDiscountAmount)).toBe('100.00');
    expect(fmtDec(totals.netAmount)).toBe('2155.00');
    expect(fmtDec(totals.totalAmount)).toBe('2411.70');
    expect(doc.documentType).toBe('I');
    expect(doc.internalID).toBe('INV-0001');
    expect(Object.keys(doc).at(-1)).toBe('totalItemsDiscountAmount');
    expect('signatures' in doc).toBe(false);
  });
  it('credit and debit notes carry document type and references', () => {
    const c = buildDocument(baseInput({ kind: 'credit', references: ['5Z40TP7SXAKADVH8WX71PXNE10'] })).doc;
    expect(c.documentType).toBe('C');
    expect(c.references).toEqual(['5Z40TP7SXAKADVH8WX71PXNE10']);
    expect(buildDocument(baseInput({ kind: 'debit', references: ['X'] })).doc.documentType).toBe('D');
    expect('references' in buildDocument(baseInput()).doc).toBe(false);
  });
  it('the text that is signed equals the text that is sent', () => {
    const { doc } = buildDocument(baseInput());
    const sent = parseDoc(documentJson(doc)) as DocObject;
    expect(canonicalize(sent)).toBe(canonicalize(doc));
  });
  it('a foreign-currency line carries amount sold and rate', () => {
    const { doc } = buildDocument(baseInput({
      lines: [{ description: 'Export', itemType: 'EGS', itemCode: 'EG-1-X', unitType: 'EA', quantity: '1', unitPriceEGP: '189.40', foreign: { currency: 'EUR', amountSold: '10', exchangeRate: '18.94' }, taxes: [{ taxType: 'T1', subType: 'V001', rate: '0' }] }],
    }));
    const uv = (doc.invoiceLines as DocObject[])[0]!.unitValue as DocObject;
    expect(uv.currencySold).toBe('EUR');
    expect(stringifyDoc(uv)).toBe('{"currencySold":"EUR","amountEGP":189.40,"amountSold":10.00,"currencyExchangeRate":18.94}');
  });
});

describe('signing boundary', () => {
  it('appends an issuer signature after signing and leaves the digest unchanged', async () => {
    const { doc } = buildDocument(baseInput());
    const before = toHex(await documentDigest(doc));
    const signed = await signDocument(doc, 'org-1', new StubSigner());
    expect((signed.signatures as DocObject[])[0]!.signatureType).toBe('I');
    expect(toHex(await documentDigest(signed))).toBe(before);
    await expect(signDocument(signed, 'org-1', new StubSigner())).rejects.toThrow('ALREADY_SIGNED');
  });
});

describe('pre-flight validation', () => {
  const codes = (i: EtaDocInput, now?: Date) => validateInput(i, now).map((x) => x.code);
  const NOW = new Date('2026-11-03T00:00:00Z');
  it('accepts a complete invoice', () => {
    expect(codes(baseInput(), NOW)).toEqual([]);
  });
  it('flags missing and wrong fields in plain words', () => {
    const i = baseInput({ dateTimeIssued: '2027-01-01T00:00:00Z' });
    i.issuer.branchId = '';
    i.receiver.id = '100200300';
    i.lines[0]!.itemCode = '';
    i.lines[1]!.taxes = [{ taxType: 'T4', subType: 'V009', rate: '5' }];
    const c = codes(i, NOW);
    expect(c).toEqual(expect.arrayContaining(['DATE_IN_FUTURE', 'BRANCH_ID', 'SAME_PARTY', 'ITEM_CODE', 'TAX_SUBTYPE']));
  });
  it('notes need references; invoices must not have them', () => {
    expect(codes(baseInput({ kind: 'credit' }), NOW)).toContain('REFERENCES_MISSING');
    expect(codes(baseInput({ references: ['x'] }), NOW)).toContain('REFERENCES_ON_INVOICE');
  });
  it('note rules against the original invoice', () => {
    const original = { etaUuid: 'U1', receiverId: '200300400', dateTimeIssued: '2026-11-01T10:00:00Z', totalAmount: '2411.70',
      lines: [{ itemCode: 'EG-100200300-FC50', quantity: '10', unitPriceEGP: '125.50' }, { itemCode: 'EG-100200300-SVC', quantity: '1', unitPriceEGP: '1000' }] };
    const ok = baseInput({ kind: 'credit', references: ['U1'] });
    ok.lines[0]!.quantity = '2';
    expect(validateNote(ok, [original], NOW)).toEqual([]);

    const tooBig = baseInput({ kind: 'credit', references: ['U1'] });
    tooBig.lines[0]!.quantity = '20';
    expect(validateNote(tooBig, [original], NOW).map((x) => x.code)).toContain('CREDIT_EXCEEDS_ORIGINAL');

    const debitBig = baseInput({ kind: 'debit', references: ['U1'] });
    debitBig.lines[0]!.quantity = '20';
    expect(validateNote(debitBig, [original], NOW).map((x) => x.code)).not.toContain('CREDIT_EXCEEDS_ORIGINAL');

    const other = { ...original, receiverId: '999' };
    expect(validateNote(ok, [other], NOW).map((x) => x.code)).toContain('REFERENCE_RECIPIENT');
    const newer = { ...original, dateTimeIssued: '2026-11-02T11:00:00Z' };
    expect(validateNote(ok, [newer], NOW).map((x) => x.code)).toContain('REFERENCE_DATE');
    const newItem = baseInput({ kind: 'credit', references: ['U1'] });
    newItem.lines[0]!.itemCode = 'EG-NEW';
    const newItemIssues = validateNote(newItem, [original], NOW);
    expect(newItemIssues.map((x) => x.code)).toEqual(expect.arrayContaining(['NOTE_NEW_ITEM', 'NOTE_MISSING_ITEM']));
    expect(newItemIssues.find((x) => x.code === 'NOTE_NEW_ITEM')?.severity).toBe('error');
    expect(newItemIssues.find((x) => x.code === 'NOTE_MISSING_ITEM')?.severity).toBe('warning'); // unverified rule: warns, does not block
    expect(validateNote(ok, [], NOW).map((x) => x.code)).toContain('REFERENCE_UNKNOWN');
  });
  it('num() rejects non-numbers', () => {
    expect(() => num('abc')).toThrow('INVALID_NUMBER_TEXT');
  });
});

describe('from our invoice to an ETA document', () => {
  const vat = { taxType: 'T1', subType: 'V009', rate: 14 };
  const company = {
    registrationNumber: '100200300', legalName: 'Test Seller LLC', activityCode: '4620',
    branch: { code: '0', address: { country: 'EG', governate: 'Cairo', regionCity: 'Nasr City', street: '1 Test St', buildingNumber: '1' } },
  };
  const customer = { taxIdType: 'B' as const, taxId: '200300400', name: 'Test Buyer LLC', country: 'EG', governate: 'Giza', regionCity: 'Dokki', street: '2 Test St', buildingNumber: '2' };
  const cream = { name: 'Face cream 50ml', etaItemType: 'EGS' as const, etaItemCode: 'EG-100200300-FC50', etaUnitCode: 'EA', defaultTaxRate: vat };
  const source = (over: Record<string, unknown> = {}) => ({
    kind: 'invoice' as const, version: '1.0' as const, number: 'INV-0001', issuedAt: '2026-11-02T10:15:00Z', currency: 'EGP', company, customer,
    lines: [{ item: cream, qty: 10, unitPriceMinor: 12550 }], ...over,
  });

  it('converts minor units and builds the same document as a hand-written input', () => {
    const { input, issues } = toEtaInput(source());
    expect(issues).toEqual([]);
    expect(input!.lines[0]!.unitPriceEGP).toBe('125.50');
    const { totals } = buildDocument(input!);
    expect(fmtDec(totals.totalSalesAmount)).toBe('1255.00');
    expect(fmtDec(totals.totalAmount)).toBe('1430.70'); // 1255.00 + 14% VAT (175.70)
    expect(validateInput(input!, new Date('2026-11-03T00:00:00Z'))).toEqual([]);
  });
  it('reports what is missing instead of guessing', () => {
    const { input, issues } = toEtaInput(source({
      lines: [{ item: { ...cream, etaItemCode: null, etaUnitCode: null, defaultTaxRate: null }, qty: 1, unitPriceMinor: 100 }],
      customer: { ...customer, taxIdType: null },
    }));
    expect(input).not.toBeNull();
    const codes = issues.map((x) => x.code);
    expect(codes).toEqual(expect.arrayContaining(['ITEM_CODE', 'UNIT_TYPE', 'NO_TAX_RATE', 'CUSTOMER_TAX_IDENTITY']));
    expect(issues.find((x) => x.code === 'NO_TAX_RATE')?.severity).toBe('warning');
  });
  it('refuses a foreign-currency invoice rather than inventing an exchange rate', () => {
    const { input, issues } = toEtaInput(source({ currency: 'USD' }));
    expect(input).toBeNull();
    expect(issues.map((x) => x.code)).toEqual(['CURRENCY_NOT_SUPPORTED']);
  });
  it('carries references for a credit note', () => {
    const { input } = toEtaInput(source({ kind: 'credit', references: ['5Z40TP7SXAKADVH8WX71PXNE10'] }));
    expect(buildDocument(input!).doc.references).toEqual(['5Z40TP7SXAKADVH8WX71PXNE10']);
  });
});

import { describe, expect, it } from 'vitest';
import { appPathFromScan, docAppPath } from './docLink';

const ID = '11111111-1111-4111-8111-111111111111';
const INV = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://erp.example.test';

describe('QR links on printed documents', () => {
  it('points an invoice at its page, a draft at its invoice once issued, and notes at their print page', () => {
    expect(docAppPath({ type: 'invoice', id: ID })).toBe(`/sales/invoices/${ID}`);
    expect(docAppPath({ type: 'draft', id: ID, invoiceId: INV })).toBe(`/sales/invoices/${INV}`);
    expect(docAppPath({ type: 'draft', id: ID, invoiceId: null })).toBe(`/sales/print/draft/${ID}`);
    expect(docAppPath({ type: 'note', id: ID })).toBe(`/sales/print/note/${ID}`);
  });

  it('opens only our own invoice and print pages on this site', () => {
    expect(appPathFromScan(`${ORIGIN}/sales/invoices/${ID}`, ORIGIN)).toBe(`/sales/invoices/${ID}`);
    expect(appPathFromScan(` ${ORIGIN}/sales/print/note/${ID} `, ORIGIN)).toBe(`/sales/print/note/${ID}`);
    // another site, even with the same path
    expect(appPathFromScan(`https://evil.example/sales/invoices/${ID}`, ORIGIN)).toBeNull();
    // another page of the app, a bad id, not a link
    expect(appPathFromScan(`${ORIGIN}/core/settings`, ORIGIN)).toBeNull();
    expect(appPathFromScan(`${ORIGIN}/sales/invoices/../../core/members`, ORIGIN)).toBeNull();
    expect(appPathFromScan(`${ORIGIN}/sales/invoices/not-an-id`, ORIGIN)).toBeNull();
    expect(appPathFromScan('6221234567890', ORIGIN)).toBeNull();
    expect(appPathFromScan(`javascript:alert(1)`, ORIGIN)).toBeNull();
  });
});

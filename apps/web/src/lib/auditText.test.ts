import { describe, expect, it } from 'vitest';
import { readableMessage, readableSummary as raw } from './auditText';

// Intl puts a no-break space between the currency code and the number; compare with plain spaces.
const readableSummary = (s: string | null, c: string) => raw(s, c).replace(/ /g, ' ');

describe('readableSummary', () => {
  it('shows invoice money instead of minor units (UX audit: invoice history)', () => {
    expect(readableSummary('INV-0329 for SO-0100: 200000 minor units (175439 before VAT, 24561 VAT) across 1 line(s)', 'EGP'))
      .toBe('INV-0329 for SO-0100: EGP 2,000.00 (EGP 1,754.39 before VAT, EGP 245.61 VAT) across 1 line(s)');
  });

  it('uses the currency written after the amount', () => {
    expect(readableSummary('PAY-0001 received: 150075 minor units USD by cash', 'EGP')).toBe('PAY-0001 received: $1,500.75 by cash');
  });

  it('formats a plain minor-units amount with the fallback currency', () => {
    expect(readableSummary('Invoice B-7 recorded for 9900 minor units across 2 line(s)', 'EGP')).toBe('Invoice B-7 recorded for EGP 99.00 across 2 line(s)');
  });

  it('formats both amounts of a cost change and a purchase approval limit', () => {
    expect(readableSummary('Cost of SKU-1 set from 1000 to 1250 minor units', 'EGP')).toBe('Cost of SKU-1 set from EGP 10.00 to EGP 12.50');
    expect(readableSummary('Purchase orders need approval from 500000 (minor units)', 'EGP')).toBe('Purchase orders need approval from EGP 5,000.00');
  });

  it('drops the stored three decimals of a quantity (UX audit: "2.000 x test cream")', () => {
    expect(readableSummary('OUT-0376 submitted: 2.000 x test cream, 2.500 x oil', 'EGP')).toBe('OUT-0376 submitted: 2 × test cream, 2.5 × oil');
    expect(readableSummary('Available 27.806, reorder level 67.000.', 'EGP')).toBe('Available 27.806, reorder level 67.');
  });

  it('leaves other text alone', () => {
    expect(readableSummary('Role changed to admin on 2026-11-02', 'EGP')).toBe('Role changed to admin on 2026-11-02');
    expect(readableSummary(null, 'EGP')).toBe('');
  });
});

describe('readableMessage', () => {
  const day = (d: string) => d.split('-').reverse().join('/');
  const read = (b: string) => {
    const r = readableMessage(b, day);
    return { ...r, first: r.first.replace(/ /g, ' ') };
  };
  it('shows one line and how many more (UX audit: overdue invoices as one paragraph)', () => {
    const body = ['Invoice INV-0033 for A is unpaid 377 day(s) after its due date 2026-11-02: 6717.31 EGP still owed', 'Invoice INV-0034 for B', '...and 62 more'].join('\n');
    expect(read(body)).toEqual({ first: 'Invoice INV-0033 for A is unpaid 377 day(s) after its due date 02/11/2026: EGP 6,717.31 still owed', more: 63 });
  });
  it('formats money and quantities in one-line messages', () => {
    expect(read('This month so far: sales 2000, cost of goods 220, expenses 85000: a loss of 83220 EGP.')).toEqual({ first: 'This month so far: sales 2000, cost of goods 220, expenses 85000: a loss of EGP 83,220.00.', more: 0 });
    expect(read('Available 27.806, reorder level 67.000').first).toBe('Available 27.806, reorder level 67');
  });
});

import { describe, expect, it } from 'vitest';
import { billingFor } from '../src/modules/sales/billing';

const lines = [
  { orderLineId: 'l1', itemId: 'i1', qty: 10 },
  { orderLineId: 'l2', itemId: 'i2', qty: 5 },
];

describe('sales billing per line', () => {
  it('flags every line as not delivered until the stock request is issued', () => {
    for (const status of [null, 'submitted', 'approved', 'rejected']) {
      expect(billingFor(lines, status, new Map()).map((b) => b.flag)).toEqual(['not_delivered', 'not_delivered']);
    }
  });

  it('flags delivered but not (fully) invoiced lines as under invoiced', () => {
    const r = billingFor(lines, 'issued', new Map([['l1', 4]]));
    expect(r[0]).toMatchObject({ ordered: 10, delivered: 10, invoiced: 4, flag: 'under_invoiced' });
    expect(r[1]).toMatchObject({ delivered: 5, invoiced: 0, flag: 'under_invoiced' });
  });

  it('is ok when invoiced equals delivered', () => {
    expect(billingFor(lines, 'issued', new Map([['l1', 10], ['l2', 5]])).map((b) => b.flag)).toEqual(['ok', 'ok']);
  });

  it('flags invoiced beyond delivered, including invoices on an undelivered order', () => {
    expect(billingFor(lines, 'issued', new Map([['l1', 11]]))[0]?.flag).toBe('over_invoiced');
    expect(billingFor(lines, 'cancelled', new Map([['l1', 1]]))[0]?.flag).toBe('over_invoiced');
  });
});

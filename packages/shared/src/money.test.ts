import { describe, expect, it } from 'vitest';
import { formatMoney } from './money';

describe('formatMoney', () => {
  it('formats a known currency', () => {
    expect(formatMoney({ amountMinor: 150075, currency: 'USD' })).toBe('$1,500.75');
  });
  it('never throws on a half-typed or unknown code (UX audit: the journal page went blank)', () => {
    expect(() => formatMoney({ amountMinor: 1000, currency: 'EG' })).not.toThrow();
    expect(formatMoney({ amountMinor: 1000, currency: 'EG' })).toContain('10.00');
    expect(() => formatMoney({ amountMinor: 1000, currency: '' })).not.toThrow();
  });
});

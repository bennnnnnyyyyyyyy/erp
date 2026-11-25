import { describe, expect, it } from 'vitest';
import { isGoodQty, isIsoDay, partyBasics, phoneOrNull, textUpTo } from '../src/lib/body';
import { plainDbError } from '../src/lib/rpc';

// Input and speed audit (25 Nov 2026): a tester of another product found month 14, 6-digit years, 40-digit phones and raw timeouts.
describe('dates', () => {
  it('accepts real days from 1900 to 2100 only', () => {
    expect(isIsoDay('2026-11-25')).toBe(true);
    expect(isIsoDay('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-14-01', '2026-00-10', '0001-01-01', '9999-12-31', '202611-01', '26-11-25', '', null, 20261125]) {
      expect(isIsoDay(bad), String(bad)).toBe(false);
    }
  });
});

describe('phone numbers', () => {
  it('accepts Egyptian and international numbers with spaces, dashes, brackets and Arabic digits', () => {
    expect(phoneOrNull('+20 100 123 4567')).toBe('+20 100 123 4567');
    expect(phoneOrNull('(02) 2345-6789')).toBe('(02) 2345-6789');
    expect(phoneOrNull('٠١٠٠١٢٣٤٥٦٧')).toBe('01001234567');
    expect(phoneOrNull('')).toBeNull();
  });
  it('refuses 40 digits, letters, too few digits and +20 with 11 digits (Ben, 25 Nov)', () => {
    for (const bad of ['1'.repeat(40), 'call me', '12345', '+20 10x 123', '+2015556487744'])
      expect(() => phoneOrNull(bad), bad).toThrow(/an Egyptian number is/);
  });
});

describe('text and quantities', () => {
  it('refuses text that is too long instead of cutting it', () => {
    expect(textUpTo('  ok  ', 5, 'Note')).toBe('ok');
    expect(() => textUpTo('x'.repeat(501), 500, 'Note')).toThrow('Note: at most 500 characters');
  });
  it('checks a customer or supplier name, contact, city and phone', () => {
    expect(partyBasics({ name: ' Nile ', phone: '01001234567' }, 'Customer name')).toEqual({
      name: 'Nile',
      contact: null,
      city: null,
      phone: '01001234567',
    });
    expect(() => partyBasics({ name: '' }, 'Customer name')).toThrow('Customer name is required');
    expect(() => partyBasics({ name: 'x'.repeat(201) }, 'Customer name')).toThrow('Customer name: at most 200 characters');
    expect(() => partyBasics({ name: 'A', city: 'c'.repeat(81) }, 'Customer name')).toThrow('City: at most 80 characters');
  });
  it('accepts quantities above 0 with at most 3 decimals, up to a billion', () => {
    expect(isGoodQty(1.5)).toBe(true);
    expect(isGoodQty(0.001)).toBe(true);
    for (const bad of [0, -1, 1.0005, 2e9, Number.NaN, Number.POSITIVE_INFINITY]) expect(isGoodQty(bad), String(bad)).toBe(false);
  });
});

describe('database errors people read', () => {
  it('turns a timeout, a busy server and database rules into plain messages', () => {
    expect(plainDbError({ code: '57014', message: 'canceling statement due to statement timeout' })).toMatchObject({
      status: 503,
      code: 'timeout',
    });
    expect(plainDbError({ code: '40P01' })).toMatchObject({ status: 503, code: 'busy' });
    expect(plainDbError({ code: '23514' })).toMatchObject({ status: 400, code: 'invalid_input' });
    expect(plainDbError({ code: '22008' })?.message).toBe('That date is not valid');
    expect(plainDbError({ code: '42501' })).toMatchObject({ status: 403 });
    expect(plainDbError({ code: 'XX000' })).toBeNull();
    expect(plainDbError(new Error('plain'))).toBeNull();
  });
});

describe('search on the server (Ben, 25 Nov 2026)', () => {
  it('keeps the search text safe inside a PostgREST filter', async () => {
    const { searchText, orFilter } = await import('../src/lib/search');
    const ctx = (q: string) =>
      ({ req: { query: (k: string) => (k === 'q' ? q : undefined) } }) as unknown as Parameters<typeof searchText>[0];
    expect(searchText(ctx('  INV-2026  '))).toBe('INV-2026');
    expect(searchText(ctx('a,b),or(id.eq.1*%'))).toBe('a b or id.eq.1');
    expect(searchText(ctx('x'.repeat(100))).length).toBe(60);
    expect(orFilter('nile', ['number'], [['customer_id', ['a1', 'b2']]])).toBe('number.ilike.*nile*,customer_id.in.(a1,b2)');
    expect(orFilter('nile', ['number', 'note'], [['supplier_id', []]])).toBe('number.ilike.*nile*,note.ilike.*nile*');
  });
});

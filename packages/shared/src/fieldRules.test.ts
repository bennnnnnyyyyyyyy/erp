import { describe, expect, it } from 'vitest';
import { bankAccountOk, emailOk, phoneCharsOnly, phoneState, registryOk } from './fieldRules';

describe('a phone number while it is typed (Ben, 25 Nov 2026)', () => {
  it('says "invalid" as soon as Ben’s 50-digit number passes the longest Egyptian number', () => {
    expect(phoneState('0155564874')).toBe('incomplete');
    expect(phoneState('01555648744')).toBe('ok');
    expect(phoneState('015556487444')).toBe('invalid');
    expect(phoneState('0155564874444444444444444444444444444444444444444444')).toBe('invalid');
    expect(phoneState('+2015556487744')).toBe('invalid');
  });
  it('lets a number grow while it can still be valid', () => {
    for (const s of ['0', '01', '010', '+', '+2', '+20', '+20 10', '00', '0020', '+9', '+97', '+971 4 555'])
      expect(phoneState(s), s).toBe('incomplete');
  });
  it('refuses a wrong start at once', () => {
    for (const s of ['013', '00 0', '+0', '1+2', '0012345678901234567']) expect(phoneState(s), s).toBe('invalid');
  });
  it('accepts finished numbers', () => {
    for (const s of ['010 0123 4567', '+20 2 2791 2345', '+971 4 555 0102', '٠١٠٠١٢٣٤٥٦٧']) expect(phoneState(s), s).toBe('ok');
    expect(phoneState('')).toBe('empty');
  });
  it('keeps only the characters a phone may have', () => {
    expect(phoneCharsOnly('01a0-1b2(3)+ ٤')).toBe('010-12(3)+ ٤');
  });
});

describe('email, registry numbers, bank accounts', () => {
  it('refuses the tester’s "lskalmsalsasm.,ma" and other non-addresses', () => {
    for (const s of ['lskalmsalsasm.,ma', 'a@b', 'a@b.c', 'a b@c.com', 'a@b,c.com', '@x.com', 'x@.com']) expect(emailOk(s), s).toBe(false);
    for (const s of ['sales@nile-trading.com.eg', 'a.b+c@x.io']) expect(emailOk(s), s).toBe(true);
  });
  it('registry numbers are digits with spaces or dashes', () => {
    expect(registryOk('123-456-789')).toBe(true);
    expect(registryOk('١٢٣٤٥٦٧٨٩')).toBe(true);
    expect(registryOk('12a4')).toBe(false);
    expect(registryOk('')).toBe(true);
  });
  it('an IBAN has its shape, an Egyptian one 29 characters; an account number is digits', () => {
    expect(bankAccountOk('EG38 0019 0005 0000 0000 2631 8000 2')).toBe(true);
    expect(bankAccountOk('EG38 0019')).toBe(false);
    expect(bankAccountOk('1234 5678 9012')).toBe(true);
    expect(bankAccountOk('hello')).toBe(false);
  });
});

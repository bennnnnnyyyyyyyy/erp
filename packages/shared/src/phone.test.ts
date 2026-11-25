import { describe, expect, it } from 'vitest';
import { checkPhone } from './phone';

const ok = (s: string) => checkPhone(s).ok;

describe('phone numbers (Ben, 25 Nov 2026)', () => {
  it('refuses +20 with 11 digits (Ben’s live test)', () => {
    expect(ok('+2015556487744')).toBe(false);
  });

  it('accepts Egyptian mobiles in every usual form', () => {
    for (const s of ['01001234567', '+201001234567', '00201001234567', '+20 100 123 4567', '010-0123-4567', '٠١٠٠١٢٣٤٥٦٧', '1201234567'])
      expect(ok(s), s).toBe(true);
  });

  it('accepts Egyptian landlines', () => {
    for (const s of ['0227912345', '+20 2 2791 2345', '034871234', '+20 3 487 1234', '0403123456', '+20 82 312 3456'])
      expect(ok(s), s).toBe(true);
  });

  it('refuses Egyptian numbers of the wrong shape', () => {
    for (const s of ['0131234567', '010012345', '+20100123456789', '0123', '0711234567', '+20 2 279']) expect(ok(s), s).toBe(false);
  });

  it('accepts other countries by the international rule', () => {
    for (const s of ['+971 4 555 0102', '+44 20 7946 0958', '+1 (212) 555-0100', '00966501234567']) expect(ok(s), s).toBe(true);
  });

  it('refuses text, too short or too long international numbers', () => {
    for (const s of ['call me', '+971 12', '+0123456789', '+1234567890123456', '12345']) expect(ok(s), s).toBe(false);
  });

  it('empty is no phone', () => {
    expect(checkPhone('  ')).toEqual({ ok: true, value: null });
    expect(checkPhone('٠١٠٠١٢٣٤٥٦٧')).toEqual({ ok: true, value: '01001234567' });
  });
});

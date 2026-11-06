import { describe, expect, it } from 'vitest';
import { AUDIT_AR } from './i18nAudit';
import { ltrIsolate, qtyLine } from './format';

// Same rules as i18nScreens.test.ts: placeholders must survive translation and every text must be Arabic.
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('audit translations', () => {
  const entries = Object.entries(AUDIT_AR);

  it('keeps every placeholder', () => {
    for (const [en, ar] of entries) expect(placeholders(ar), en).toBe(placeholders(en));
  });

  it('is actually Arabic', () => {
    for (const [en, ar] of entries) expect(/[؀-ۿ]/.test(ar), en).toBe(true);
  });
});

describe('quantity lines', () => {
  it('uses × in both languages and keeps the plain text for CSV and search', () => {
    expect(qtyLine(30, 'Safety gloves')).toBe('30 × Safety gloves');
  });

  it('isolates left-to-right text so an Arabic page does not reorder it', () => {
    const t = ltrIsolate('30 × Safety gloves');
    expect(t.startsWith(String.fromCodePoint(0x2066))).toBe(true);
    expect(t.endsWith(String.fromCodePoint(0x2069))).toBe(true);
    expect(t.slice(1, -1)).toBe('30 × Safety gloves');
  });

});

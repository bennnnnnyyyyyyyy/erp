import { describe, expect, it } from 'vitest';
import { PRINTING_AR } from './i18nPrinting';

// Invoice printing texts (sql/103): every entry is Arabic and keeps its placeholders.
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

describe('printing translations', () => {
  it('is Arabic, never empty, and keeps every placeholder', () => {
    for (const [en, ar] of Object.entries(PRINTING_AR)) {
      expect(ar.trim(), en).not.toBe('');
      expect(/[؀-ۿ]/.test(ar), en).toBe(true);
      expect(placeholders(ar), en).toBe(placeholders(en));
    }
  });
});

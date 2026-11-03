import { describe, expect, it } from 'vitest';
import { SCREENS_AR } from './i18nScreens';

// Placeholders ({name}) and bold markers (**) must survive translation, or a sentence renders with a hole in it.
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
const bolds = (s: string) => (s.match(/\*\*/g) ?? []).length;

describe('screen translations', () => {
  const entries = Object.entries(SCREENS_AR);

  it('has a translation for every entry', () => {
    expect(entries.length).toBeGreaterThan(600);
    for (const [en, ar] of entries) expect(ar.trim(), en).not.toBe('');
  });

  it('keeps every placeholder and bold marker', () => {
    for (const [en, ar] of entries) {
      expect(placeholders(ar), en).toBe(placeholders(en));
      expect(bolds(ar), en).toBe(bolds(en));
    }
  });

  it('is actually Arabic', () => {
    for (const [en, ar] of entries) {
      if (en === 'No.' || /^\(?[A-Z]{3}\)?$/.test(en)) continue;
      expect(/[؀-ۿ]/.test(ar), en).toBe(true);
    }
  });
});

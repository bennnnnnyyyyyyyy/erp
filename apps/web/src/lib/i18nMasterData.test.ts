import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MASTER_DATA_AR } from './i18nMasterData';

// Item groups and codes (sql/095): every new string has Arabic, with its placeholders kept.
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
const stringsIn = (file: string) =>
  [...readFileSync(join(__dirname, file), 'utf8').matchAll(/\btrf?\('((?:[^'\\]|\\.)*)'/g)].map((m) =>
    (m[1] ?? '').replace(/\\u2019/g, '’').replace(/\\'/g, "'"),
  );

describe('master data translations', () => {
  it('is Arabic and keeps every placeholder', () => {
    for (const [en, ar] of Object.entries(MASTER_DATA_AR)) {
      expect(/[؀-ۿ]/.test(ar), en).toBe(true);
      expect(placeholders(ar), en).toBe(placeholders(en));
    }
  });

  it('covers every text on the item groups screen', async () => {
    const { tr } = await import('./i18n');
    expect(tr('Item groups')).toBe('Item groups'); // English while English is in use
    for (const en of stringsIn('../modules/inventory/ItemGroups.tsx')) {
      const known = en in MASTER_DATA_AR || ['Code', 'Name', 'Status', 'Actions', 'Active', 'Edit', 'Remove', 'Cancel', 'Save changes', 'Saving…', 'Under', 'Number of digits', 'Example: {code}', 'Name in Arabic (optional)'].includes(en);
      expect(known, en).toBe(true);
    }
  });
});

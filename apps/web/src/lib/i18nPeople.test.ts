import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProvider } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { PEOPLE_AR } from './i18nPeople';

// People and the HR app card (sql/102): every new string has Arabic, with its placeholders kept.
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
const stringsIn = (file: string) =>
  [...readFileSync(join(__dirname, file), 'utf8').matchAll(/\btrf?\('((?:[^'\\]|\\.)*)'/g)].map((m) => (m[1] ?? '').replace(/\\'/g, "'"));

describe('People translations', () => {
  it('is Arabic and keeps every placeholder', () => {
    for (const [en, ar] of Object.entries(PEOPLE_AR)) {
      expect(/[؀-ۿ]/.test(ar), en).toBe(true);
      expect(placeholders(ar), en).toBe(placeholders(en));
    }
  });

  it('covers every text on the People screen and the HR app card', async () => {
    const i18n = await import('./i18n');
    // tr() answers in English while English is in use, so look the texts up through the Arabic count instead: every text must be a
    // key of one of the Arabic tables, which tr() reads.
    const tables = await Promise.all([
      import('./i18nNav'), import('./i18nScreens'), import('./i18nAudit'), import('./i18nErrors'), import('./i18nUxAudit'),
      import('./i18nDecisions'), import('./i18nMasterData'), import('./i18nPeople'),
    ]);
    const known = new Set(tables.flatMap((m) => Object.values(m).flatMap((t) => (t && typeof t === 'object' ? Object.keys(t) : []))));
    expect(i18n.arabicStringCount).toBeGreaterThan(0);
    const hr = findProvider('hr_app')!;
    const texts = [
      ...stringsIn('../modules/hr/People.tsx'),
      'Active', 'On leave', 'Left', 'HR and payroll',
      hr.name, hr.summary, ...hr.fields.flatMap((f) => [f.label, ...(f.help ? [f.help] : [])]),
    ];
    const builtIn = ['Saved.', 'Someone', 'Status', 'All', 'Branch', 'Name', 'Number', 'Confirm', 'Link', 'Unlink'];
    for (const en of texts) expect(known.has(en) || builtIn.includes(en), en).toBe(true);
  });
});

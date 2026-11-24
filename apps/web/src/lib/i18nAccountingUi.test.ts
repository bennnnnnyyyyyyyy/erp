import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AR } from './i18n';
import { ACCOUNTING_UI_AR } from './i18nAccountingUi';
import { REPORTS_UI_AR } from './i18nReportsUi';

// The new-UI accounting screens (journal entry, trial balance, VAT month; Grant signs off) are in Arabic too, and their table never
// redefines a text another table already translates (one English text, one Arabic wording).
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
const stringsIn = (file: string) =>
  [...readFileSync(join(__dirname, file), 'utf8').matchAll(/\btrf?\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1'));

async function otherTables(): Promise<Record<string, string>[]> {
  const mods = await Promise.all([
    import('./i18nNav'), import('./i18nScreens'), import('./i18nAudit'), import('./i18nErrors'), import('./i18nUxAudit'), import('./i18nDecisions'),
    import('./i18nMasterData'), import('./i18nPeople'), import('./i18nPrinting'), import('./i18nScanning'), import('./i18nReports'), import('./i18nSignIn'),
  ]);
  return mods.flatMap((m) => Object.values(m).filter((t): t is Record<string, string> => !!t && typeof t === 'object'));
}

// Also the new-UI report screens (REPORTS_UI_AR, same rules).
const NEW_UI_AR = { ...ACCOUNTING_UI_AR, ...REPORTS_UI_AR };

describe('new-UI accounting and report translations', () => {
  it('is Arabic and keeps every placeholder', () => {
    for (const [en, ar] of Object.entries(NEW_UI_AR)) {
      expect(/[؀-ۿ]/.test(ar), en).toBe(true);
      expect(placeholders(ar), en).toBe(placeholders(en));
    }
  });

  it('does not redefine a text another table already translates', async () => {
    const others = await otherTables();
    for (const en of Object.keys(NEW_UI_AR)) expect(others.some((t) => en in t), en).toBe(false);
    for (const en of Object.keys(REPORTS_UI_AR)) expect(en in ACCOUNTING_UI_AR, en).toBe(false);
  });

  it('covers every text on the new accounting and report screens', () => {
    const files = ['../modules/accounting/JournalFormNew.tsx', '../modules/accounting/TrialBalanceNew.tsx', '../modules/finance/VatMonthNew.tsx', '../modules/reports/LibraryNew.tsx', '../modules/reports/ForecastNew.tsx'];
    for (const f of files) for (const en of stringsIn(f)) expect(en in AR, `${f}: ${en}`).toBe(true);
  });
});

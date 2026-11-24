import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULES } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { AREAS, LIBRARY } from '../modules/reports/reportLibrary';
import { REPORTS_AR } from './i18nReports';

// Reports & Insights: every text on its screens has Arabic, and this table never changes another feature's Arabic.
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
const stringsIn = (file: string) =>
  [...readFileSync(join(__dirname, file), 'utf8').matchAll(/\btrf?\('((?:[^'\\]|\\.)*)'/g)].map((m) => (m[1] ?? '').replace(/\\'/g, "'"));

async function otherTables(): Promise<Record<string, string>[]> {
  const mods = await Promise.all([
    import('./i18nNav'), import('./i18nScreens'), import('./i18nAudit'), import('./i18nErrors'), import('./i18nUxAudit'),
    import('./i18nDecisions'), import('./i18nMasterData'), import('./i18nPeople'), import('./i18nPrinting'), import('./i18nScanning'),
  ]);
  return mods.flatMap((m) => Object.values(m).filter((t): t is Record<string, string> => !!t && typeof t === 'object'));
}

describe('Reports & Insights translations', () => {
  it('is Arabic and keeps every placeholder', () => {
    for (const [en, ar] of Object.entries(REPORTS_AR)) {
      expect(/[؀-ۿ]/.test(ar), en).toBe(true);
      expect(placeholders(ar), en).toBe(placeholders(en));
    }
  });

  it('does not redefine a text another table already translates', async () => {
    const others = await otherTables();
    for (const en of Object.keys(REPORTS_AR)) expect(others.some((t) => en in t), en).toBe(false);
  });

  it('covers the library screen, its areas, its descriptions and the module text', async () => {
    const known = new Set([...Object.keys(REPORTS_AR), ...(await otherTables()).flatMap((t) => Object.keys(t))]);
    const mod = MODULES.find((m) => m.key === 'reports');
    expect(mod).toBeTruthy();
    const labels = await import('../modules/reports/labels');
    const ops = ['eq', 'ne', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty'] as const;
    // The plain sentences of the shared definition check (the limits filled in, as the builder shows them).
    const shared = readFileSync(join(__dirname, '../../../../packages/shared/src/reports.ts'), 'utf8');
    const limits: Record<string, number> = { columns: 20, groupBy: 2, totals: 5, filters: 10, sort: 3, rows: 5000 };
    const problems = [...shared.matchAll(/return [`']([^`']+)[`'];/g)].map((m) => (m[1] ?? '').replace(/\$\{REPORT_LIMITS\.(\w+)\}/g, (_, k: string) => String(limits[k])));
    expect(problems.length).toBeGreaterThan(25);
    const texts = [
      ...stringsIn('../modules/reports/Library.tsx'),
      ...stringsIn('../modules/reports/Builder.tsx'),
      ...stringsIn('../modules/reports/ReportChart.tsx'),
      ...stringsIn('../modules/reports/cells.ts'),
      ...Object.values(labels.SOURCE_LABELS),
      ...Object.values(labels.COLUMN_LABELS),
      ...Object.values(labels.FN_LABELS),
      ...Object.values(labels.VALUE_LABELS).flatMap((m) => Object.values(m)).filter((v) => !/^[0-9+-]+$/.test(v)),
      ...ops.flatMap((op) => [labels.opLabel(op, 'text'), labels.opLabel(op, 'date')]),
      ...problems,
      ...AREAS.map((a) => a.label),
      ...LIBRARY.map((e) => e.description),
      mod?.name ?? '', mod?.description ?? '',
    ];
    for (const en of texts) expect(known.has(en), en).toBe(true);
  });
});

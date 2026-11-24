import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPORT_TEMPLATES } from './reportTemplates';
import { reportDefinitionProblem, type ReportSource } from './reports';

// Every ready-made report must be valid on the database's own list of sources: the list is read from sql/109 itself.
const sql = readFileSync(join(__dirname, '../../../sql/109_rpt_reports.sql'), 'utf8');
const json = sql.slice(sql.indexOf('$j$') + 3, sql.lastIndexOf('$j$'));
const catalog = JSON.parse(json) as Record<
  string,
  { module: string; period: string | null; periodRequired: boolean; currency: string | null; columns: ReportSource['columns'] }
>;
const sources: ReportSource[] = Object.entries(catalog).map(([key, s]) => ({
  key,
  module: s.module,
  period: s.period,
  periodRequired: s.periodRequired,
  hasCurrency: s.currency !== null,
  columns: s.columns.map((c) => ({ key: c.key, type: c.type })),
}));

describe('ready-made reports', () => {
  it('reads the sources from sql/109', () => expect(sources.length).toBe(9));

  it.each(REPORT_TEMPLATES.map((t) => [t.key, t] as const))('%s is valid on its source', (_k, t) => {
    const source = sources.find((s) => s.key === t.definition.source);
    expect(source, t.definition.source).toBeTruthy();
    const period = t.period ? { from: '2026-11-01', to: '2026-11-30' } : null;
    expect(reportDefinitionProblem({ ...t.definition, period }, source)).toBeNull();
    expect(source?.period ? t.period !== null || !source.periodRequired : t.period === null).toBe(true);
  });

  it('has unique keys the database accepts', () => {
    const keys = REPORT_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]{1,60}$/);
  });

  it('covers every area', () => {
    expect(new Set(REPORT_TEMPLATES.map((t) => t.area))).toEqual(new Set(['sales', 'buy', 'stock', 'money', 'tax']));
  });
});

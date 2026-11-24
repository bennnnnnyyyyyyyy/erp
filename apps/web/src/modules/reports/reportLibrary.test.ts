import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AREAS, LIBRARY, libraryFor } from './reportLibrary';

// The registry is read as text (importing it would load every screen, which needs a browser; see lib/i18nNav.test.ts).
const registry = readFileSync(join(__dirname, '../registry.tsx'), 'utf8');

describe('report library', () => {
  it('links only to pages that exist in the registry', () => {
    for (const e of LIBRARY) {
      const [, base = '', ...rest] = e.path.split('/');
      const page = rest.length ? `/${rest.join('/')}` : '';
      expect(registry.includes(`basePath: '/${base}'`), e.path).toBe(true);
      expect(registry.includes(`path: '${page}'`), e.path).toBe(true);
    }
  });

  it('lists each report once, in a known area', () => {
    expect(new Set(LIBRARY.map((e) => e.path)).size).toBe(LIBRARY.length);
    const areas = new Set(AREAS.map((a) => a.key));
    for (const e of LIBRARY) expect(areas.has(e.area), e.path).toBe(true);
  });

  it('shows only the reports the person can open, in area order, and drops empty areas', () => {
    const open: Record<string, string> = { '/finance/vat': 'VAT summary', '/inventory/stock': 'Stock on hand', '/sales/invoices': 'Sales invoices' };
    const shown = libraryFor((p) => open[p] ?? null);
    expect(shown.map((a) => a.key)).toEqual(['sales', 'stock', 'tax']);
    expect(shown.flatMap((a) => a.reports.map((r) => r.title))).toEqual(['Sales invoices', 'Stock on hand', 'VAT summary']);
  });

  it('shows nothing to a person who can open no report', () => {
    expect(libraryFor(() => null)).toEqual([]);
  });

  it('searches the title and the description, in the language shown', () => {
    const all = (p: string) => (p === '/finance/vat' ? 'VAT summary' : p === '/inventory/forecast' ? 'Stock forecast' : null);
    expect(libraryFor(all, 'vat').flatMap((a) => a.reports.map((r) => r.path))).toEqual(['/finance/vat']);
    expect(libraryFor(all, 'RUN OUT').flatMap((a) => a.reports.map((r) => r.path))).toEqual(['/inventory/forecast']);
    const arabic = (s: string) => (s === 'VAT summary' ? 'ملخص الضريبة' : s);
    expect(libraryFor(all, 'الضريبة', arabic).flatMap((a) => a.reports.map((r) => r.path))).toEqual(['/finance/vat']);
    expect(libraryFor(all, 'nothing like this')).toEqual([]);
  });
});

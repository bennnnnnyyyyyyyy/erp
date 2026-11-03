import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV_AR } from './i18nNav';

// Every word the navigation layer shows must have an Arabic text, so a new app or page cannot quietly appear in English in an Arabic session.
// (A string with no Arabic entry falls back to English, which is the right behaviour at runtime, and the wrong thing to ship unnoticed.)
// The registry is read as text because importing it would load every screen, and those need a browser.

const registry = readFileSync(join(__dirname, '../modules/registry.tsx'), 'utf8');
const quoted = (s: string) => [...s.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => (m[1] as string).replace(/\\'/g, "'"));

const names = [...registry.matchAll(/\bname:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => (m[1] as string).replace(/\\'/g, "'"));
const labels = [...registry.matchAll(/\blabel:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => (m[1] as string).replace(/\\'/g, "'"));
// A description is a quoted string, or (in the demo build) a choice between two quoted strings, on one line.
const descriptions = registry.split('\n').filter((l) => /\bdescription:\s*(demoMode\s*\?\s*)?'/.test(l)).flatMap((l) => quoted(l.slice(l.indexOf('description:'))).filter((x) => x.length > 12));
const suites = quoted(registry.slice(registry.indexOf('export const SUITE_ORDER'), registry.indexOf('\n', registry.indexOf('export const SUITE_ORDER')))).filter((s) => s !== 'suite');

describe('Arabic for the navigation layer', () => {
  it('finds the registry text it is supposed to check (guards the test itself)', () => {
    expect(names.length).toBeGreaterThanOrEqual(9);
    expect(labels.length).toBeGreaterThanOrEqual(30);
    expect(descriptions.length).toBeGreaterThanOrEqual(11);
    expect(suites).toEqual(['Warehouse', 'Sales & Purchasing', 'Finance', 'Core']);
  });
  it('has an Arabic text for every suite, app name, app description and page label', () => {
    const missing = [...suites, ...names, ...descriptions, ...labels].filter((s) => !NAV_AR[s]);
    expect([...new Set(missing)]).toEqual([]);
  });
  it('every Arabic text is Arabic, never empty, and never the English key repeated', () => {
    const ARABIC = /[\u0600-\u06FF]/;
    for (const [en, ar] of Object.entries(NAV_AR)) {
      expect(ar.trim().length, en).toBeGreaterThan(0);
      expect(ARABIC.test(ar), en).toBe(true);
      expect(ar, en).not.toBe(en);
    }
  });
  it('translates the greeting, the roles and the empty-home notice', () => {
    for (const k of ['Good morning', 'Good afternoon', 'Good evening', 'owner', 'admin', 'member', 'viewer', 'No apps are available to you yet. Ask an admin for access.']) {
      expect(NAV_AR[k], k).toBeTruthy();
    }
  });
});
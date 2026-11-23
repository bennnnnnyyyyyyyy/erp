import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// New UI progress (lib/uiMode.ts; new UI plan, point 2): which pages in the page list (modules/registry.tsx) have no new-UI screen yet,
// counted per module. Such a page still works in the new UI: it shows its old screen inside the new frame. This test only REPORTS; it
// never fails the build (the count goes down as tabs are redesigned).
// The registry is read as text, like i18nNav.test.ts, because importing it would load every screen.

const registry = readFileSync(join(__dirname, '../modules/registry.tsx'), 'utf8');

type Row = { module: string; path: string; label: string; done: boolean };
function pages(text: string): Row[] {
  const rows = new Map<string, Row>();
  let module = '';
  for (const line of text.split('\n')) {
    const m = /\bmodule:\s*'([^']+)'/.exec(line);
    if (m) module = m[1] as string;
    if (!/\bpath:\s*'/.test(line) || !/\bcomponent:\s*\w+/.test(line)) continue;
    if (/\bnewOnly:\s*true/.test(line)) continue;
    for (const p of line.matchAll(/\{\s*path:\s*'([^']*)',\s*label:\s*'((?:[^'\\]|\\.)*)'[^}]*\}/g)) {
      const entry = p[0];
      const key = `${module} ${p[1]}`;
      const done = /\bnewComponent:\s*\w+/.test(entry);
      // The sample-data and the real build list some pages twice: count each module and path once (done if either has a new screen).
      const before = rows.get(key);
      rows.set(key, { module, path: p[1] as string, label: p[2] as string, done: done || (before?.done ?? false) });
    }
  }
  return [...rows.values()];
}

describe('new UI coverage (report only)', () => {
  const rows = pages(registry);

  it('finds the page list (guards the test itself)', () => {
    expect(rows.length).toBeGreaterThan(40);
  });

  it('lists the pages that have no new-UI screen yet, per module (never fails)', () => {
    const byModule = new Map<string, { todo: string[]; done: number }>();
    for (const r of rows) {
      const m = byModule.get(r.module) ?? { todo: [], done: 0 };
      if (r.done) m.done += 1;
      else m.todo.push(`${r.label} (${r.path || '/'})`);
      byModule.set(r.module, m);
    }
    const todo = rows.filter((r) => !r.done).length;
    const lines = [...byModule.entries()]
      .sort((a, b) => b[1].todo.length - a[1].todo.length)
      .map(([mod, m]) => `  ${mod.padEnd(12)} ${String(m.todo.length).padStart(3)} still old · ${m.done} new`);
    console.info(`New UI coverage: ${rows.length - todo} of ${rows.length} pages have a new-UI screen; ${todo} still show the old screen.\n${lines.join('\n')}`);
    expect(true).toBe(true);
  });
});

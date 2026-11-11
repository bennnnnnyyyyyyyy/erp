import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Audit 11 Nov: a table header with no text leaves screen reader users with an unnamed column.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

describe('table headers', () => {
  it('no <th> is empty (give action columns a visually hidden label)', () => {
    const empty = /<th\b[^>]*\/>|<th\b[^>]*>\s*<\/th>/;
    const offenders = sources(join(__dirname, '..')).filter((f) => empty.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

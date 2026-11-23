import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

const web = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

describe('product brand (new UI)', () => {
  it('the logo and the mark are files of this app (no request to another site at run time)', () => {
    for (const file of [BRAND.logo, BRAND.mark]) {
      expect(file.startsWith('/')).toBe(true);
      expect(existsSync(web(`public${file}`))).toBe(true);
    }
  });

  it('the old UI keeps its own page title: the new UI sets the product name at start-up (main.tsx), not in index.html', () => {
    expect(readFileSync(web('index.html'), 'utf8')).not.toContain(BRAND.name);
    expect(readFileSync(web('src/main.tsx'), 'utf8')).toContain('document.title = BRAND.name');
  });
});

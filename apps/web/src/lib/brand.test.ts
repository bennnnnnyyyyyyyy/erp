import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

const web = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

describe('product brand', () => {
  it('index.html shows the same product name as brand.ts before the app starts', () => {
    const html = readFileSync(web('index.html'), 'utf8');
    expect(html).toContain(`<title>${BRAND.name}</title>`);
  });

  it('the logo and the mark are files of this app (no request to another site at run time)', () => {
    for (const file of [BRAND.logo, BRAND.mark]) {
      expect(file.startsWith('/')).toBe(true);
      expect(existsSync(web(`public${file}`))).toBe(true);
    }
  });
});

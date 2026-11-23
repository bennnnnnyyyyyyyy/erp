import { expect, test } from '@playwright/test';

// A letterhead as a one-page PDF (src/modules/core/settings/letterheadPdf.ts): pdf.js must load in the real browser (its worker file
// through Vite), draw the page and give a JPEG picture within the size limit. A two-page PDF is refused. The PDFs are made here, with a
// coloured band only (no fonts), so the test needs no files.

/** A minimal PDF: `pages` A4 pages, each with a filled band at the top. Offsets in the cross-reference table are exact. */
function makePdf(pages: number): string {
  const objs: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  const draw = '0.1 0.3 0.6 rg 0 742 595 100 re f';
  for (let i = 0; i < pages; i++) {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

test.beforeEach(({ browserName }, info) => {
  test.skip(info.project.name !== 'desktop' || browserName !== 'chromium', 'desktop Chrome only');
});

test('a one-page PDF letterhead becomes an A4 picture; two pages are refused', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });

  const result = await page.evaluate(async ({ one, two }) => {
    const mod = await import('/src/modules/core/settings/letterheadPdf.ts');
    const file = (text: string) => new File([text], 'letterhead.pdf', { type: 'application/pdf' });
    const url: string = await mod.letterheadFromPdf(file(one), 2_100_000);
    const img = new Image();
    img.src = url;
    await img.decode();
    // The band at the top is blue; the middle of the page is white.
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    ctx.drawImage(img, 0, 0);
    const top = Array.from(ctx.getImageData(Math.round(img.width / 2), 20, 1, 1).data);
    const middle = Array.from(ctx.getImageData(Math.round(img.width / 2), Math.round(img.height / 2), 1, 1).data);
    let twoPages = '';
    try { await mod.letterheadFromPdf(file(two), 2_100_000); } catch (e) { twoPages = (e as Error).message; }
    return { prefix: url.slice(0, 23), length: url.length, width: img.width, height: img.height, top, middle, twoPages };
  }, { one: makePdf(1), two: makePdf(2) });

  expect(result.prefix).toBe('data:image/jpeg;base64,');
  expect(result.length).toBeLessThanOrEqual(2_100_000);
  expect(result.width).toBe(1240);
  expect(Math.abs(result.height - 1754)).toBeLessThanOrEqual(1);   // A4: 1240 x 1754
  expect(result.top[2]).toBeGreaterThan(120);                      // blue band
  expect(result.top[0]).toBeLessThan(60);
  expect(result.middle.slice(0, 3).every((v) => v > 240)).toBe(true); // white paper
  expect(result.twoPages).toContain('one page');
  expect(errors).toEqual([]);
});

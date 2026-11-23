import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Layout picture tests of the printed invoice (invoice printing, step 1c; plan section 9): each layout (simple, detailed, ETA) in Arabic
// and English, the ETA layout in both languages, and a draft with its DRAFT mark. The sample build serves fixed sample data (src/lib/demoPrint.ts), so a changed picture means the printed page changed.
//
// Pictures differ between Windows and Linux (fonts are drawn differently), so Playwright keeps one set per system (the file name ends in
// -win32 or -linux). A system without its pictures skips these tests instead of failing; CI (Linux) skips until a Linux set is added.
// Make or refresh the pictures on purpose, after checking the page by eye:
//   npx playwright test print --project desktop --update-snapshots          (in apps/web)

test.beforeEach(({ browserName }, info) => {
  test.skip(info.project.name !== 'desktop' || browserName !== 'chromium', 'A4 sheet: desktop Chrome only');
});

async function openSheet(page: Page, path: string, layout: 'simple' | 'detailed' | 'eta', language: 'ar' | 'en' | 'both') {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  await page.goto(path);
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Layout').selectOption(layout);
  await page.getByLabel('Language of the document').selectOption(language);
  const sheet = page.locator('.print-sheet').first();
  await expect(sheet).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(problems, `${path}: errors in the browser`).toEqual([]);
  return sheet;
}

function needsPicture(name: string) {
  const info = test.info();
  const updating = info.config.updateSnapshots === 'all' || info.config.updateSnapshots === 'changed';
  test.skip(!updating && !existsSync(info.snapshotPath(name)), `no ${name} picture for ${process.platform} yet (see the top of this file)`);
}

// A window taller than the A4 sheet, so the picture needs no scrolling: when scrolled, the app's sticky top bar and the Design Lab
// button (dev server only, in its own shadow root, so page styles cannot hide it) were drawn over the sheet.
test.use({ viewport: { width: 1280, height: 1900 } });
const PICTURE = { maxDiffPixelRatio: 0.01, animations: 'disabled' as const };

const CASES = [
  ...(['simple', 'detailed', 'eta'] as const).flatMap((layout) => (['ar', 'en'] as const).map((language) => ({ layout, language }))),
  { layout: 'eta' as const, language: 'both' as const },
];

for (const { layout, language } of CASES) {
  test(`issued invoice, ${layout} layout, ${language}`, async ({ page }) => {
    const name = `invoice-${layout}-${language}.png`;
    needsPicture(name);
    const sheet = await openSheet(page, '/sales/print/invoice/demo-inv-1', layout, language);
    await expect(sheet.getByText('INV-2026-00001').first()).toBeVisible();
    await expect(sheet).toHaveScreenshot(name, PICTURE);
  });
}

test('draft invoice, ETA layout, Arabic, with the DRAFT mark', async ({ page }) => {
  const name = 'draft-eta-ar.png';
  needsPicture(name);
  const sheet = await openSheet(page, '/sales/print/draft/demo-draft-1', 'eta', 'ar');
  await expect(sheet).toHaveScreenshot(name, PICTURE);
});

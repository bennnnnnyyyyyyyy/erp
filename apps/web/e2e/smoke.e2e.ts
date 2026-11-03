import { expect, test, type Page } from '@playwright/test';

// Smoke test of every screen in the sample build. Finds the pages itself (Home tiles -> each app's sidebar -> the first record in each
// list), so a new screen is covered without editing this file. Each page must: render a heading, not show "Page not found", and log no
// console error or uncaught exception. On phones it also checks that nothing makes the page scroll sideways.

function watch(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`exception: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  return problems;
}

async function checkPage(page: Page, path: string, problems: string[], phone: boolean) {
  problems.length = 0;
  await page.goto(path);
  const heading = page.locator('main h1').first();
  await expect(heading, `${path}: no heading`).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Page not found'), `${path}: page not found`).toHaveCount(0);
  await page.waitForTimeout(300);   // let late requests and effects settle
  expect(problems, `${path}: errors in the browser`).toEqual([]);
  if (phone) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path}: page scrolls sideways on a phone by ${overflow}px`).toBeLessThanOrEqual(1);
  }
}

async function hrefs(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('href') ?? '').filter((h) => h.startsWith('/')))]);
}

test('every screen of the sample build renders without errors', async ({ page }, info) => {
  const phone = info.project.name === 'phone';
  const problems = watch(page);
  await checkPage(page, '/', problems, phone);
  const apps = await hrefs(page, 'a.tile');
  expect(apps.length, 'no app tiles on Home').toBeGreaterThan(0);

  const seen = new Set<string>(['/']);
  for (const app of apps) {
    await checkPage(page, app, problems, phone);
    seen.add(app);
    // Sidebar links (on a phone the sidebar is a drawer, but its links are in the page either way).
    const pages = await hrefs(page, 'nav a.nav-item, .sidebar a');
    for (const p of pages) {
      if (seen.has(p)) continue;
      seen.add(p);
      await checkPage(page, p, problems, phone);
      // The first record in the list, if the page has clickable rows.
      const record = (await hrefs(page, 'tr.row-link a')).find((h) => !seen.has(h));
      if (record) { seen.add(record); await checkPage(page, record, problems, phone); }
    }
  }
  info.annotations.push({ type: 'pages', description: `${seen.size} pages checked` });
  expect(seen.size, 'suspiciously few pages found').toBeGreaterThan(10);
});

test('right-to-left layout renders the main screens without errors', async ({ page }) => {
  const problems = watch(page);
  for (const path of ['/', '/inventory', '/inventory/requests', '/purchasing', '/sales']) {
    await page.goto(path);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
    expect(problems, `${path} (rtl): errors in the browser`).toEqual([]);
  }
});

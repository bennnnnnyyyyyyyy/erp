import { expect, test, type Browser, type Page } from '@playwright/test';

// Real workflow, real database (see playwright.workflows.config.ts): a staff member asks for stock, cannot approve it, the owner
// approves and issues it, the stock goes down by exactly that amount, and the other company sees none of it.
// People come from scripts/e2e-seed.mjs; the password is E2E_PASSWORD, made fresh for each CI run.

const PASSWORD = process.env.E2E_PASSWORD ?? '';
const OWNER_A = 'owner-a@e2e.test';
const STAFF_A = 'staff-a@e2e.test';
const OWNER_B = 'owner-b@e2e.test';

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.log(`[${email}] exception: ${e.message}`));
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape'); // closes the guided tour if it started by itself
  return page;
}

let requestUrl = '';

test.describe.configure({ mode: 'serial' });

test('a staff member asks for stock and cannot approve their own request', async ({ browser }) => {
  expect(PASSWORD, 'E2E_PASSWORD is not set').not.toBe('');
  const staff = await signIn(browser, STAFF_A);
  await staff.goto('/inventory/requests/new');
  await expect(staff.getByRole('heading', { name: 'Send goods out' })).toBeVisible();
  await staff.getByLabel('Reason').fill('Workflow test');
  await staff.getByLabel('Item', { exact: true }).selectOption({ label: 'GLV-001 · Safety gloves' });
  await staff.getByLabel(/^Quantity/).fill('5');
  await staff.getByRole('button', { name: 'Submit for approval' }).click();

  await expect(staff).toHaveURL(/\/inventory\/requests\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  requestUrl = new URL(staff.url()).pathname;
  await expect(staff.getByText('Waiting for a manager to approve.')).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('the owner approves and issues it, and the stock goes down by exactly 5', async ({ browser }) => {
  expect(requestUrl, 'the first test did not create a request').not.toBe('');
  const owner = await signIn(browser, OWNER_A);
  await owner.goto(requestUrl);
  await owner.getByRole('button', { name: 'Approve' }).click();
  await expect(owner.getByText('Approved. The stock can now be issued.')).toBeVisible({ timeout: 20_000 });

  await owner.getByRole('button', { name: 'Issue stock' }).click();
  await owner.getByRole('button', { name: 'Yes, issue' }).click();
  await expect(owner.getByText('Stock issued and recorded in the ledger.')).toBeVisible({ timeout: 20_000 });

  // The ledger, not the screen state: a fresh page load of the stock list shows 100 - 5.
  await owner.goto('/inventory/stock');
  const row = owner.getByRole('row').filter({ hasText: 'Safety gloves' }).first();
  await expect(row).toContainText('95', { timeout: 20_000 });
});

test('the other company sees none of it, even with the direct link', async ({ browser }) => {
  const other = await signIn(browser, OWNER_B);
  await other.goto('/inventory/requests');
  await expect(other.getByRole('heading', { name: 'Stock requests' })).toBeVisible();
  await expect(other.getByText('Workflow test')).toHaveCount(0);
  await other.goto('/inventory/stock');
  await expect(other.getByText('Company B item')).toBeVisible({ timeout: 20_000 });
  await expect(other.getByText('Safety gloves')).toHaveCount(0);

  await other.goto(requestUrl);
  await expect(other.getByText('Workflow test')).toHaveCount(0);
  await expect(other.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

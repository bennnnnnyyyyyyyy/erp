import { expect, test } from '@playwright/test';
import { OWNER_A, OWNER_B, STAFF_A, signIn } from './helpers';

// Real workflow, real database (see playwright.workflows.config.ts): a staff member asks for stock, cannot approve it, the owner
// approves and issues it, the stock goes down by exactly that amount, and the other company sees none of it.

// A reason no screen shows by itself (getByText ignores case and matches inside longer text: "Workflow test" matched "Workflow Test B").
const REASON = 'E2E-REQ-7F3A';

let requestUrl = '';

test.describe.configure({ mode: 'serial' });

test('a staff member asks for stock and cannot approve their own request', async ({ browser }) => {
  const staff = await signIn(browser, STAFF_A);
  await staff.goto('/inventory/requests/new');
  await expect(staff.getByRole('heading', { name: 'Send goods out' })).toBeVisible();
  await staff.getByLabel('Reason').fill(REASON);
  // The select sits inside its label, so its accessible name includes the chosen option ("Item Choose an item…"); find it by its label.
  const itemSelect = staff.locator('label').filter({ hasText: /^Item/ }).locator('select');
  await expect(itemSelect.locator('option', { hasText: 'Safety gloves' })).toHaveCount(1, { timeout: 20_000 });
  await itemSelect.selectOption({ label: 'GLV-001 · Safety gloves' });
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
  await expect(other.getByText('No requests yet.', { exact: false })).toBeVisible({ timeout: 20_000 }); // loaded, and empty
  await expect(other.locator('main').getByText(REASON)).toHaveCount(0);
  await other.goto('/inventory/stock');
  await expect(other.getByText('Company B item')).toBeVisible({ timeout: 20_000 });
  await expect(other.locator('main').getByText('Safety gloves')).toHaveCount(0);

  // Wait for the API's answer to the direct link, then for the page's error state, so "nothing shown" cannot just mean "still loading".
  const requestId = requestUrl.split('/').pop() ?? '';
  const answer = other.waitForResponse((r) => r.url().includes(`/v1/inventory/requests/${requestId}`) && r.request().method() === 'GET');
  await other.goto(requestUrl);
  expect((await answer).status(), 'company B was given company A’s request').toBe(404);
  await expect(other.locator('main p.error')).toBeVisible({ timeout: 20_000 });
  await expect(other.locator('main').getByText(REASON)).toHaveCount(0);
  await expect(other.getByRole('heading', { name: /Safety gloves|REQ-/ })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { OWNER_A, signIn } from './helpers';

// Real workflow, real database: on an issued invoice (INV-E2E-1: 10 × Face cream 50ml at 125.50, seeded), the owner raises a credit note
// for 2; it waits for approval and the amount owed is unchanged; the owner, as the company's only owner or manager, approves it (D1b);
// then the invoice shows 251.00 credited (2 × 125.50) and the amount owed after notes.

const REASON = 'E2E-CN-2B9C damaged on arrival';

test('a credit note is raised, waits for approval, and once approved lowers what the customer owes', async ({ browser }) => {
  const owner = await signIn(browser, OWNER_A);

  await owner.goto('/sales/invoices');
  await owner.getByRole('link', { name: 'INV-E2E-1' }).click();
  await expect(owner).toHaveURL(/\/sales\/invoices\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(owner.getByText('No credit or debit notes on this invoice.')).toBeVisible({ timeout: 20_000 });

  await owner.getByRole('button', { name: 'Credit note', exact: true }).click();
  const form = owner.getByRole('dialog', { name: 'New credit note' });
  await expect(form).toBeVisible();
  await form.getByLabel(/^Quantity for /).fill('2');
  await form.getByLabel(/^Reason/).fill(REASON);
  await form.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(form).toHaveCount(0, { timeout: 20_000 });

  // Waiting: it does not count yet.
  const row = owner.getByRole('row').filter({ hasText: 'CN-0001' });
  await expect(row).toContainText('Waiting for approval', { timeout: 20_000 });
  await expect(owner.getByText('Amount owed after notes')).toHaveCount(0);

  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  const decide = owner.getByRole('dialog', { name: 'Approve CN-0001' });
  await decide.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(decide).toHaveCount(0, { timeout: 20_000 });
  await expect(row).toContainText('Approved', { timeout: 20_000 });

  // A fresh load: the database's numbers, not the screen state.
  await owner.reload();
  const credited = owner.locator('dt', { hasText: 'Credited' }).locator('xpath=following-sibling::dd[1]');
  await expect(credited).toContainText('251.00', { timeout: 20_000 });
  await expect(owner.getByText('Amount owed after notes')).toBeVisible();
});

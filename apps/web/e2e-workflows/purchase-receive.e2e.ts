import { expect, test } from '@playwright/test';
import { OWNER_A, signIn, pick } from './helpers';

// Real workflow, real database: the owner orders 10 boxes from a supplier; the order waits for approval (on by default, sql/069) and
// goods cannot be received yet; the owner, as the company's only owner or manager, approves it (marked self-approved, D1b); the goods
// are received; stock on hand goes from 0 to exactly 10. Seed: "Delta Supplies" and "Cardboard boxes" (BOX-001, no stock).

test('an order is placed, approved, received, and the stock goes from 0 to 10', async ({ browser }) => {
  const owner = await signIn(browser, OWNER_A);

  await owner.goto('/purchasing/orders/new');
  await expect(owner.getByRole('heading', { name: 'New purchase order' })).toBeVisible({ timeout: 20_000 });
  await pick(owner, 'Supplier', 'Delta', 'Delta Supplies');
  await pick(owner, 'Item', 'BOX', 'BOX-001 · Cardboard boxes');
  await owner.getByLabel(/^Quantity/).fill('10');
  await owner.getByLabel(/^Unit cost/).fill('12.50');
  await owner.getByRole('button', { name: 'Place order' }).click();
  await expect(owner).toHaveURL(/\/purchasing\/orders\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  // Waiting for approval: no receiving yet.
  await expect(owner.getByText('This order is waiting for approval by an owner or manager.', { exact: false })).toBeVisible();
  await expect(owner.getByRole('button', { name: 'Receive goods' })).toHaveCount(0);

  await owner.getByRole('button', { name: 'Approve order' }).click();
  await expect(owner.getByText('Order approved. The goods can now be received.')).toBeVisible({ timeout: 20_000 });
  await expect(owner.getByText('self-approved: no second approver in the company', { exact: false })).toBeVisible();

  await owner.getByRole('button', { name: 'Receive goods' }).click();
  await expect(owner.getByLabel('Arrived now: Cardboard boxes')).toHaveValue('10');
  await owner.getByRole('button', { name: 'Receive into stock' }).click();
  await expect(owner.getByText('Goods received. The quantities were added to stock and the ledger.')).toBeVisible({ timeout: 20_000 });

  // The ledger, not the screen state: a fresh load of the stock list.
  await owner.goto('/inventory/stock');
  const row = owner.getByRole('row').filter({ hasText: 'Cardboard boxes' }).first();
  await expect(row).toContainText('10', { timeout: 20_000 });
  await expect(row).not.toContainText('No stock yet');
});

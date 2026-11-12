import { expect, type Browser, type Page } from '@playwright/test';

// Shared by the workflow tests. People come from scripts/e2e-seed.mjs; the password is E2E_PASSWORD, made fresh for each CI run.
export const PASSWORD = process.env.E2E_PASSWORD ?? '';
export const OWNER_A = 'owner-a@e2e.test';
export const STAFF_A = 'staff-a@e2e.test';
export const OWNER_B = 'owner-b@e2e.test';

/** Signs in with a password in a fresh browser context and waits until the sign-in screen has really gone. */
export async function signIn(browser: Browser, email: string): Promise<Page> {
  expect(PASSWORD, 'E2E_PASSWORD is not set').not.toBe('');
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.log(`[${email}] exception: ${e.message}`));
  // A person with no saved language is asked to choose one on first sign-in (LanguageChooser); whenever it covers the page, pick English.
  // Only the dialog: the box inside it carries the same label.
  await page.addLocatorHandler(page.locator('[role="dialog"][aria-labelledby="lang-chooser-title"]').first(), async (dialog) => {
    await dialog.getByRole('button', { name: 'English', exact: true }).click();
  });
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Signed in only once the sign-in screen has gone and another page heading shows (the sign-in screen has an h1 of its own).
  const signInHeading = page.getByRole('heading', { name: 'Sign in', exact: true });
  try {
    await expect(signInHeading).toHaveCount(0, { timeout: 30_000 });
  } catch (e) {
    console.log(`[${email}] still on the sign-in screen: ${await page.locator('main').innerText().catch(() => '')}`);
    throw e;
  }
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape'); // closes the guided tour if it started by itself
  return page;
}

/** Picks an option in a SearchSelect (a combobox you type into, then a listbox of options). */
export async function pick(page: Page, combobox: string, typed: string, option: string) {
  const box = page.getByRole('combobox', { name: combobox, exact: true });
  await box.click();
  await box.fill(typed);
  await page.getByRole('option', { name: option }).click();
}

import { expect, test } from '@playwright/test';

// Ben, 25 Nov 2026: the "Edit customer" dialog let him type a 50-digit phone and a very long name; checking only when Save is pressed
// is not enough. The boxes must guide the person while they type (components/Fields.tsx). Runs on the sample build, which edits
// customers in memory with the same dialog. SHOT_DIR=<folder> also saves screenshots (for the review).

const shot = (name: string) => (process.env.SHOT_DIR ? { path: `${process.env.SHOT_DIR}/${name}.png` } : {});

test('the edit customer dialog guides while typing: phone, name limit, Save off', async ({ page }, info) => {
  await page.goto('/sales/customers');
  await page.getByRole('button', { name: /^Edit / }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const save = dialog.getByRole('button', { name: 'Save changes' });

  // Phone: Ben's 50+ digit number. Letters are dropped, the box stops at 20, a red line shows at once, Save is off.
  const phone = dialog.getByLabel(/Phone/);
  await phone.fill('');
  await phone.pressSequentially('0155564874444abc4444444444444444444444444444444444');
  const typed = await phone.inputValue();
  expect(typed.length).toBeLessThanOrEqual(20);
  expect(typed).not.toMatch(/[a-z]/i);
  await expect(dialog.getByText('An Egyptian mobile is 11 digits: 01x xxxx xxxx.', { exact: false })).toBeVisible();
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  await expect(save).toBeDisabled();
  await page.screenshot({ ...shot(`edit-customer-bad-phone-${info.project.name}`), fullPage: false });

  // A good number: the line goes, Save is on again.
  await phone.fill('010 0123 4567');
  await expect(dialog.getByText('An Egyptian mobile is 11 digits', { exact: false })).toHaveCount(0);
  await expect(save).toBeEnabled();

  // Name: the box stops at 200 and shows the counter near the limit.
  const name = dialog.getByLabel('Name');
  await name.fill('testd' + 'w'.repeat(400));
  expect((await name.inputValue()).length).toBe(200);
  await expect(dialog.getByText('200/200')).toBeVisible();
  await page.screenshot({ ...shot(`edit-customer-long-name-${info.project.name}`), fullPage: false });

  // Save with a good phone and the 200-character name works (the sample build keeps it in memory).
  await save.click();
  await expect(dialog).toHaveCount(0);
});

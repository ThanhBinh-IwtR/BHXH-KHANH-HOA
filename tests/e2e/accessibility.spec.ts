import { expect, test } from '@playwright/test';

import { mockApi } from '../fixtures/mock-api';

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
});

test('has a single top-level heading and a labelled composer', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByLabel(/nhập câu hỏi về bhxh/i)).toBeVisible();
});

test('announces progress and errors through live regions', async ({ page }) => {
  await page.getByLabel(/nhập câu hỏi về bhxh/i).fill('Gây timeout server');
  await page.keyboard.press('Enter');
  await expect(page.locator('.error-banner')).toBeVisible();
});

test('supports keyboard-only citation opening', async ({ page }) => {
  await page.getByLabel(/nhập câu hỏi về bhxh/i).fill('Tỷ lệ đóng?');
  await page.keyboard.press('Enter');
  const chip = page.getByRole('button', { name: /mở nguồn 158\/2025/i }).first();
  await expect(page.getByRole('note')).toContainText(/có thể có sai sót/i);
  await expect(chip).toHaveAttribute('aria-label', /trang 8/i);
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('renders no uncaught console errors during a full flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByLabel(/nhập câu hỏi về bhxh/i).fill('Tỷ lệ đóng?');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/đóng 17%/i)).toBeVisible();
  expect(errors).toEqual([]);
});

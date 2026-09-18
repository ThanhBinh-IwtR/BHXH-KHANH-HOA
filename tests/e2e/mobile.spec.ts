import { expect, test } from '@playwright/test';

import { mockApi } from '../fixtures/mock-api';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
});

test('opens the sidebar as a drawer on mobile', async ({ page }) => {
  for (const name of [/quốc huy việt nam/i, /logo bảo hiểm xã hội việt nam/i]) {
    const image = page.getByRole('img', { name });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByText('Sản phẩm MVP/DEMO nội bộ')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const menu = page.getByRole('button', { name: /mở menu/i });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole('button', { name: /cuộc trò chuyện mới/i })).toBeVisible();
});

test('answers and shows the source as a bottom sheet', async ({ page }) => {
  await page.getByLabel(/nhập câu hỏi về bhxh/i).fill('Tỷ lệ đóng?');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/đóng 17%/i)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: /mở nguồn 158\/2025/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Bottom sheet spans the full width on mobile.
  const box = await dialog.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(350);
});

test('keeps the composer usable with a 44px minimum touch target', async ({ page }) => {
  const send = page.getByRole('button', { name: /gửi câu hỏi/i });
  await page.getByLabel(/nhập câu hỏi về bhxh/i).fill('Câu hỏi');
  const box = await send.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
});

test('can cancel an in-flight request and retry a failed request', async ({ page }) => {
  const input = page.getByLabel(/nhập câu hỏi về bhxh/i);

  await input.fill('Câu hỏi cancel request');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /hủy yêu cầu/i })).toBeVisible();
  await page.getByRole('button', { name: /hủy yêu cầu/i }).click();
  await expect(input).toBeEnabled();

  await input.fill('Gây timeout server');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /thử lại câu hỏi/i })).toBeVisible();
  await page.getByRole('button', { name: /thử lại câu hỏi/i }).click();
  await expect(page.getByRole('button', { name: /thử lại câu hỏi/i })).toBeVisible();
});

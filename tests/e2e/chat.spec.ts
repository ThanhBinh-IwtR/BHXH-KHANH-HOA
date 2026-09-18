import { expect, test } from '@playwright/test';

import { mockApi } from '../fixtures/mock-api';

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
});

test('shows the corpus scope and example questions', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /bảo hiểm xã hội tỉnh khánh hòa/i })).toBeVisible();
  for (const name of [/quốc huy việt nam/i, /logo bảo hiểm xã hội việt nam/i]) {
    const image = page.getByRole('img', { name });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByText('Sản phẩm MVP/DEMO nội bộ')).toBeVisible();
  await expect(page.getByText(/bốn nghị định trong bộ dữ liệu demo/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /khoản 3 điều 12/i })).toBeVisible();
});

test('answers a grounded question and opens the source drawer', async ({ page }) => {
  await page.getByLabel(/nhập câu hỏi về bhxh/i).fill('Tỷ lệ đóng của người sử dụng lao động?');
  await page.keyboard.press('Enter');

  await expect(page.getByText(/đủ căn cứ trong bộ tài liệu/i)).toBeVisible();
  await expect(page.getByText(/đóng 17%/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quy định chính' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Điều kiện và đối tượng' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cách áp dụng' })).toBeVisible();

  await page.getByRole('button', { name: /mở nguồn 158\/2025/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText(/tỷ lệ 17%/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /mở pdf/i })).toHaveAttribute('href', /#page=8/);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('starts a new chat and clears the conversation', async ({ page }) => {
  await page.getByLabel(/nhập câu hỏi về bhxh/i).fill('Câu hỏi đầu tiên');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Câu hỏi đầu tiên')).toBeVisible();

  await page.getByRole('button', { name: /cuộc trò chuyện mới/i }).click();
  await expect(page.getByText('Câu hỏi đầu tiên')).toBeHidden();
  await expect(page.getByText(/bốn nghị định trong bộ dữ liệu demo/i)).toBeVisible();
});

test('renders each legal scope state', async ({ page }) => {
  const input = page.getByLabel(/nhập câu hỏi về bhxh/i);

  await input.fill('Trường hợp này ngoài phạm vi của bộ tài liệu?');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-badge').last()).toContainText(/ngoài phạm vi tài liệu/i);
  await expect(page.getByText(/ngoài bốn nghị định trong bộ dữ liệu demo/i)).toBeVisible();
  await expect(page.getByText(/cổng thông tin chính thức của bhxh/i)).toBeVisible();

  await input.fill('Bạn có thể làm rõ giúp tôi?');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-badge').last()).toContainText(/cần thêm thông tin/i);
  await expect(page.getByText(/nhóm đối tượng tham gia cụ thể/i)).toBeVisible();
  await expect(page.getByText(/bạn thuộc nhóm tham gia bhxh bắt buộc hay tự nguyện/i)).toBeVisible();

  await input.fill('Câu hỏi một phần');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-badge').last()).toContainText(/một phần/i);
  await expect(page.getByText(/phần điều kiện còn lại cần đối chiếu/i)).toBeVisible();
  await expect(page.getByText(/bạn có thể bổ sung dữ kiện/i)).toBeVisible();
});

test('surfaces provider errors and rate limiting', async ({ page }) => {
  const input = page.getByLabel(/nhập câu hỏi về bhxh/i);

  await input.fill('Gây timeout server');
  await page.keyboard.press('Enter');
  await expect(page.locator('.error-banner')).toContainText(/không khả dụng/i);

  await input.fill('Gây ratelimit');
  await page.keyboard.press('Enter');
  await expect(page.locator('.error-banner')).toContainText(/quá nhiều yêu cầu/i);
});

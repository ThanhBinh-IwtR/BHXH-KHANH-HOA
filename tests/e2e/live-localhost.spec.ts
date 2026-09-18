import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { isProviderBlockedStatus } from './live-e2e-support';

test.skip(!process.env.RUN_LIVE_E2E, 'Set RUN_LIVE_E2E=1 to run against live localhost providers.');

interface Measurement {
  index: number;
  status: number;
  scopeStatus: string | null;
  e2eMs: number;
  llmCallCount: number;
  stages: Record<string, number>;
}

function parseServerTiming(value: string | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const name of ['retrieval', 'context', 'generation', 'verification']) {
    const match = new RegExp(name + ';dur=(\\d+)').exec(value ?? '');
    if (match) result[name] = Number(match[1]);
  }
  return result;
}

async function ask(page: Page, message: string, index: number): Promise<Measurement> {
  const input = page.getByLabel(/nhập câu hỏi về bhxh/i);
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith('/api/chat') && response.request().method() === 'POST',
    { timeout: 70_000 },
  );
  const started = Date.now();
  await input.fill(message);
  await input.press('Enter');
  const response = await responsePromise;
  const e2eMs = Date.now() - started;

  let payload: { scopeStatus?: unknown } = {};
  if (response.ok()) {
    payload = (await response.json()) as { scopeStatus?: unknown };
    await expect(page.locator('.answer-card').last()).toBeVisible({ timeout: 5_000 });
  } else {
    await expect(page.locator('.error-banner')).toBeVisible({ timeout: 5_000 });
  }
  await expect(input).toBeEnabled({ timeout: 5_000 });

  return {
    index,
    status: response.status(),
    scopeStatus: typeof payload.scopeStatus === 'string' ? payload.scopeStatus : null,
    e2eMs,
    llmCallCount: Number(response.headers()['x-rag-llm-call-count'] ?? -1),
    stages: parseServerTiming(response.headers()['server-timing']),
  };
}

async function runGroup(page: Page, messages: readonly string[]): Promise<Measurement[]> {
  const results: Measurement[] = [];
  for (const [index, message] of messages.entries()) {
    const result = await ask(page, message, index + 1);
    results.push(result);
    if (isProviderBlockedStatus(result.status)) {
      break;
    }
    expect.soft(result.status, 'live chat HTTP status').toBe(200);
    expect.soft(result.scopeStatus, 'live chat scope').toBe('grounded');
    expect.soft(result.llmCallCount, 'live chat LLM call count').toBe(1);
  }
  return results;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function summarize(results: readonly Measurement[]) {
  return {
    count: results.length,
    p50Ms: percentile(results.map((item) => item.e2eMs), 0.5),
    p95Ms: percentile(results.map((item) => item.e2eMs), 0.95),
    errorCount: results.filter((item) => item.status >= 400).length,
    rateLimitCount: results.filter((item) => item.status === 429).length,
    llmCallCounts: results.map((item) => item.llmCallCount),
    measurements: results,
  };
}

function writeReport(
  project: string,
  exact: readonly Measurement[],
  natural: readonly Measurement[],
  blockedReason?: string,
  notes?: Record<string, number | string | boolean>,
) {
  const outDir = resolve('tmp', 'evaluation');
  mkdirSync(outDir, { recursive: true });
  const filename = 'live-localhost-' + project + '-' + Date.now() + '.json';
  writeFileSync(
    resolve(outDir, filename),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        project,
        blockedReason,
        notes,
        exact: summarize(exact),
        natural: summarize(natural),
      },
      null,
      2,
    ),
  );
}

const EXACT_MESSAGES = [
  'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?',
  'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định mức đóng nào?',
  'Điều 12 Nghị định 158/2025/NĐ-CP, khoản 3 nói gì về tỷ lệ đóng?',
  'Nghị định 158/2025/NĐ-CP khoản 3 Điều 12 quy định tỷ lệ đóng ra sao?',
  'Cho biết nội dung khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP.',
] as const;

const NATURAL_MESSAGES = [
  'Người sử dụng lao động phải đóng bao nhiêu vào quỹ hưu trí và tử tuất?',
  'Cho tôi biết tỷ lệ đóng hàng tháng vào quỹ hưu trí và tử tuất của bên sử dụng lao động.',
  'Trong BHXH bắt buộc, doanh nghiệp đóng bao nhiêu phần trăm cho quỹ hưu trí và tử tuất?',
  'Mức đóng của người sử dụng lao động vào quỹ hưu trí, tử tuất được tính thế nào?',
  'Tỷ lệ đóng 17 phần trăm của doanh nghiệp dựa theo quy định nào?',
] as const;

test.describe('live localhost desktop', () => {
  test('measures exact and natural grounded flows and opens the real citation', async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Desktop measurement runs only once.');
    testInfo.setTimeout(12 * 60_000);
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/');
    const exact = await runGroup(page, EXACT_MESSAGES);
    const providerBlocked = exact.some((result) => isProviderBlockedStatus(result.status));
    const natural = providerBlocked ? [] : await runGroup(page, NATURAL_MESSAGES);
    if (
      providerBlocked ||
      exact.length < EXACT_MESSAGES.length ||
      natural.length < NATURAL_MESSAGES.length
    ) {
      writeReport(testInfo.project.name, exact, natural, 'provider_rate_limited_or_unavailable');
      test.skip(true, 'Provider quota/permission prevented the complete 5+5 latency sample.');
      return;
    }

    const citation = page.getByRole('button', { name: /mở nguồn/i }).first();
    await citation.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText(/trang 8/i);
    const pdfLink = page.getByRole('link', { name: /mở pdf đúng trang/i });
    const pdfHref = await pdfLink.getAttribute('href');
    expect(pdfHref).toMatch(/#page=8$/);
    const pdfUrl = new URL(pdfHref ?? '', 'http://localhost:3100');
    const pdf = await request.get(pdfUrl.origin + pdfUrl.pathname);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toMatch(/application\/pdf/);
    expect((await pdf.body()).subarray(0, 4)).toEqual(Buffer.from('%PDF'));
    await page.keyboard.press('Escape');

    await expect(page.getByRole('note')).toContainText(/có thể có sai sót/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(consoleErrors).toEqual([]);
    writeReport(testInfo.project.name, exact, natural);
  });
});

test.describe('live localhost mobile', () => {
  test('keeps 390px/360px layout usable and cancels an in-flight request', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop', 'Mobile check runs in mobile projects.');
    testInfo.setTimeout(3 * 60_000);
    await page.goto('/');
    const input = page.getByLabel(/nhập câu hỏi về bhxh/i);
    const exact = await ask(page, EXACT_MESSAGES[0], 1);
    if (
      isProviderBlockedStatus(exact.status)
    ) {
      writeReport(testInfo.project.name, [exact], [], 'provider_rate_limited_or_unavailable');
      test.skip(true, 'Provider quota/permission prevented the mobile grounded smoke.');
      return;
    }
    expect(exact.status).toBe(200);
    expect(exact.scopeStatus).toBe('grounded');
    await expect(page.getByRole('note')).toContainText(/có thể có sai sót/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const initialAnswers = await page.locator('.answer-card').count();
    const started = Date.now();
    await input.fill('Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: /hủy yêu cầu/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /hủy yêu cầu/i }).click();
    await expect(input).toBeEnabled({ timeout: 1_000 });
    const cancelUiMs = Date.now() - started;
    expect(cancelUiMs).toBeLessThan(1_000);
    await page.waitForTimeout(1_500);
    expect(await page.locator('.answer-card').count()).toBe(initialAnswers);
    writeReport(testInfo.project.name, [exact], [], undefined, {
      cancelUiMs,
      viewportWidth: await page.evaluate(() => innerWidth),
    });
  });
});

test('returns out-of-scope without generation on the live server', async ({ page }, testInfo) => {
  testInfo.setTimeout(20_000);
  await page.goto('/');
  const result = await ask(page, 'Tôi cần làm hộ chiếu mới ở đâu?', 1);
  expect(result.status).toBe(200);
  expect(result.scopeStatus).toBe('out_of_scope');
  expect(result.llmCallCount).toBe(0);
  expect(result.e2eMs).toBeLessThan(3_000);
});

test('opens a grounded citation and the correct PDF page on the live server', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Citation smoke runs once on desktop.');
  testInfo.setTimeout(90_000);
  await page.goto('/');
  const result = await ask(page, EXACT_MESSAGES[0], 1);
  if (isProviderBlockedStatus(result.status)) {
    test.skip(true, 'Provider quota/latency prevented the grounded citation smoke.');
    return;
  }
  expect(result.status).toBe(200);
  expect(result.scopeStatus).toBe('grounded');
  await page.getByRole('button', { name: /mở nguồn/i }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/trang 8/i);
  const href = await dialog.getByRole('link', { name: /mở pdf đúng trang/i }).getAttribute('href');
  expect(href).toMatch(/#page=8$/);
  const url = new URL(href ?? '', 'http://localhost:3100');
  const pdf = await request.get(url.origin + url.pathname);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4)).toEqual(Buffer.from('%PDF'));
});

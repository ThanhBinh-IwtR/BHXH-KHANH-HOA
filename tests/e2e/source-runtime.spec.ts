import { expect, test } from '@playwright/test';

test('serves source JSON and the allowlisted PDF through the running Next server', async ({ request }) => {
  const source = await request.get(
    '/api/sources/nd-158-2025%3Adieu-12%3Akhoan-3%3A2025-demo-v1',
  );
  expect(source.status()).toBe(200);
  const sourceJson = await source.json();
  expect(sourceJson.pdfUrl).toBe('/corpus/158_2025_ND-CP_25062025-signed.pdf#page=8');

  const pdf = await request.get('/corpus/158_2025_ND-CP_25062025-signed.pdf');
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toMatch(/application\/pdf/);
  expect((await pdf.body()).subarray(0, 4)).toEqual(Buffer.from('%PDF'));
});

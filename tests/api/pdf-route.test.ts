import { describe, expect, it } from 'vitest';

import { GET } from '@/app/corpus/[filename]/route';

const filenames = [
  '157_2025_ND-CP_25062025-signed.pdf',
  '158_2025_ND-CP_25062025-signed.pdf',
  '159_2025_ND-CP_25062025-signed.pdf',
  '188_2025_ND-CP_01072025-signed.pdf',
];

function get(filename: string) {
  return GET(new Request(`http://localhost/corpus/${encodeURIComponent(filename)}`) as never, {
    params: Promise.resolve({ filename }),
  });
}

describe('GET /corpus/:filename', () => {
  it.each(filenames)('serves the allowlisted PDF %s', async (filename) => {
    const response = await get(filename);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/pdf/);
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );
  });

  it('returns 404 for an unknown or traversal filename', async () => {
    expect((await get('missing.pdf')).status).toBe(404);
    expect((await get('../157_2025_ND-CP_25062025-signed.pdf')).status).toBe(404);
  });
});

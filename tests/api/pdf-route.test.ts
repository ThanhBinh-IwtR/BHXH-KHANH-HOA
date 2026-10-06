// @vitest-environment node

import { statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GET, HEAD } from '@/app/corpus/[filename]/route';
import { parseByteRange } from '@/lib/corpus/byte-range';

const filenames = [
  '157_2025_ND-CP_25062025-signed.pdf',
  '158_2025_ND-CP_25062025-signed.pdf',
  '159_2025_ND-CP_25062025-signed.pdf',
  '188_2025_ND-CP_01072025-signed.pdf',
];
const LARGEST = '188_2025_ND-CP_01072025-signed.pdf';
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function sizeOf(filename: string): number {
  return statSync(join(process.cwd(), 'LUATBHXHBHYT2024', filename)).size;
}

function request(filename: string, headers: Record<string, string> = {}, method = 'GET') {
  return [
    new Request(`http://localhost/corpus/${encodeURIComponent(filename)}`, { method, headers }) as never,
    { params: Promise.resolve({ filename }) },
  ] as const;
}

describe('GET /corpus/:filename', () => {
  it.each(filenames)('streams the allowlisted PDF %s with its length', async (filename) => {
    const response = await GET(...request(filename));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/application\/pdf/);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe(String(sizeOf(filename)));
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.slice(0, 4)).toEqual(PDF_MAGIC);
    expect(bytes.byteLength).toBe(sizeOf(filename));
  });

  it('returns 206 with exactly the requested bytes for a Range request', async () => {
    const size = sizeOf(LARGEST);
    const response = await GET(...request(LARGEST, { range: 'bytes=0-3' }));

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 0-3/${size}`);
    expect(response.headers.get('content-length')).toBe('4');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_MAGIC);
  });

  it('serves a suffix range from the end of the largest PDF without reading it whole', async () => {
    const size = sizeOf(LARGEST);
    const response = await GET(...request(LARGEST, { range: 'bytes=-1024' }));

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes ${size - 1024}-${size - 1}/${size}`);
    const tail = await response.arrayBuffer();
    expect(tail.byteLength).toBe(1024);
    expect(new TextDecoder('latin1').decode(tail)).toContain('%%EOF');
  });

  it('answers 416 for a range beyond the end of the file', async () => {
    const size = sizeOf(LARGEST);
    const response = await GET(...request(LARGEST, { range: `bytes=${size}-` }));

    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe(`bytes */${size}`);
  });

  it('ignores a multi-range request and serves the full file', async () => {
    const response = await GET(...request(filenames[2], { range: 'bytes=0-3,10-20' }));

    expect(response.status).toBe(200);
    await response.body?.cancel();
  });

  it('answers HEAD with the headers and no body', async () => {
    const response = await HEAD(...request(LARGEST, {}, 'HEAD'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(sizeOf(LARGEST)));
    expect(response.body).toBeNull();
  });

  it('returns 404 for an unknown or traversal filename', async () => {
    expect((await GET(...request('missing.pdf'))).status).toBe(404);
    expect((await GET(...request('../157_2025_ND-CP_25062025-signed.pdf'))).status).toBe(404);
  });
});

describe('parseByteRange', () => {
  it.each([
    ['bytes=0-99', 1000, { start: 0, end: 99 }],
    ['bytes=900-', 1000, { start: 900, end: 999 }],
    ['bytes=-100', 1000, { start: 900, end: 999 }],
    ['bytes=-5000', 1000, { start: 0, end: 999 }],
    ['bytes=990-2000', 1000, { start: 990, end: 999 }],
  ] as const)('parses %s of %d bytes', (header, size, expected) => {
    expect(parseByteRange(header, size)).toEqual(expected);
  });

  it.each([null, 'bytes=-', 'bytes=5-1', 'items=0-1', 'bytes=0-1,4-5'])(
    'ignores %s and serves the whole file',
    (header) => {
      expect(parseByteRange(header, 1000)).toBeNull();
    },
  );

  it.each(['bytes=1000-', 'bytes=-0'])('marks %s unsatisfiable', (header) => {
    expect(parseByteRange(header, 1000)).toBe('unsatisfiable');
  });
});

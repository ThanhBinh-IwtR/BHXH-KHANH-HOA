import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { NextResponse, type NextRequest } from 'next/server';

import { parseByteRange } from '@/lib/corpus/byte-range';
import { getCorpusPdfPath } from '@/lib/corpus/pdf-allowlist';

export const runtime = 'nodejs';

const NOT_FOUND_MESSAGE = 'Không tìm thấy tài liệu.';

/**
 * Serve an allowlisted corpus PDF as a stream. Browser PDF viewers request
 * byte ranges to jump to the cited page, so single `Range` requests get a
 * `206 Partial Content` and nothing is ever buffered whole in memory.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> },
): Promise<NextResponse> {
  const { filename } = await context.params;
  const path = getCorpusPdfPath(filename);
  if (!path) return notFound();

  let size: number;
  let modified: Date;
  try {
    const info = await stat(path);
    if (!info.isFile()) return notFound();
    size = info.size;
    modified = info.mtime;
  } catch {
    return notFound();
  }

  const headers = new Headers({
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${filename}"`,
    'cache-control': 'public, max-age=300',
    'accept-ranges': 'bytes',
    'last-modified': modified.toUTCString(),
  });

  const range = parseByteRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${size}`);
    return new NextResponse(null, { status: 416, headers });
  }

  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers.set('content-length', String(size === 0 ? 0 : end - start + 1));
  if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`);

  const body =
    size === 0
      ? null
      : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>);
  return new NextResponse(body, { status: range ? 206 : 200, headers });
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> },
): Promise<NextResponse> {
  const response = await GET(request, context);
  await response.body?.cancel();
  return new NextResponse(null, { status: response.status, headers: response.headers });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
}

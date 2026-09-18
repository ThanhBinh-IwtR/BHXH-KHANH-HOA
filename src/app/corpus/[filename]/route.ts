import { readFile } from 'node:fs/promises';

import { NextResponse, type NextRequest } from 'next/server';

import { getCorpusPdfPath } from '@/lib/corpus/pdf-allowlist';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ filename: string }> },
): Promise<NextResponse> {
  const { filename } = await context.params;
  const path = getCorpusPdfPath(filename);
  if (!path) return NextResponse.json({ error: 'Không tìm thấy tài liệu.' }, { status: 404 });

  try {
    const file = await readFile(path);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${filename}"`,
        'cache-control': 'public, max-age=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Không tìm thấy tài liệu.' }, { status: 404 });
  }
}

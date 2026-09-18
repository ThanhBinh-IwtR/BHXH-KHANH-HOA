import { NextResponse, type NextRequest } from 'next/server';

import { getCorpusPdfUrl } from '@/lib/corpus/pdf-allowlist';
import { RepositoryUnavailableError } from '@/lib/db/legal-repository';
import { apiError } from '@/lib/http/errors';
import { createRagDeps } from '@/features/legal-rag/service-factory';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  if (!id) return apiError('invalid_request', 'Thiếu mã nguồn.');

  try {
    const deps = createRagDeps();
    const chunk = await deps.repository.getSource(id);
    if (!chunk) return apiError('not_found', 'Không tìm thấy nguồn trong bộ tài liệu hiện tại.');

    const documents = await deps.repository.getDocuments();
    const document = documents.find((doc) => doc.documentId === chunk.documentId);
    if (!document) return apiError('not_found', 'Không tìm thấy tài liệu tương ứng.');
    const pdfUrl = getCorpusPdfUrl(document.documentId, chunk.pageFrom);
    if (!pdfUrl) return apiError('not_found', 'Tài liệu không thuộc corpus được phép.');

    return NextResponse.json({
      sourceId: chunk.chunkId,
      documentNumber: chunk.documentNumber,
      breadcrumb: chunk.contextHeader,
      articleTitle: chunk.articleTitle,
      bodyText: chunk.bodyText,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
      // The PDF URL comes from the trusted document record, never from input.
      pdfUrl,
    });
  } catch (error) {
    if (error instanceof RepositoryUnavailableError) {
      return apiError('provider_unavailable', 'Dịch vụ tạm thời không khả dụng.');
    }
    return apiError('internal_error', 'Đã xảy ra lỗi nội bộ.');
  }
}

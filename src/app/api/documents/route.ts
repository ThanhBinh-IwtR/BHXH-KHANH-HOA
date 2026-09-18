import { NextResponse } from 'next/server';

import { getCorpusPdfUrl } from '@/lib/corpus/pdf-allowlist';
import { RepositoryUnavailableError } from '@/lib/db/legal-repository';
import { apiError } from '@/lib/http/errors';
import { createRagDeps } from '@/features/legal-rag/service-factory';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const documents = await createRagDeps().repository.getDocuments();
    return NextResponse.json({
      documents: documents.flatMap((doc) => {
        const pdfUrl = getCorpusPdfUrl(doc.documentId);
        if (!pdfUrl) return [];
        return [{
        documentId: doc.documentId,
        documentNumber: doc.documentNumber,
        documentType: doc.documentType,
        title: doc.title,
        effectiveDate: doc.effectiveDate,
        pdfUrl,
        }];
      }),
    });
  } catch (error) {
    if (error instanceof RepositoryUnavailableError) {
      return apiError('provider_unavailable', 'Dịch vụ tạm thời không khả dụng.');
    }
    return apiError('internal_error', 'Đã xảy ra lỗi nội bộ.');
  }
}

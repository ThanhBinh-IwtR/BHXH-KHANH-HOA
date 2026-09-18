import { join } from 'node:path';

const CORPUS_DIRECTORY = join(process.cwd(), 'LUATBHXHBHYT2024');

const PDF_BY_DOCUMENT_ID = {
  'nd-157-2025': '157_2025_ND-CP_25062025-signed.pdf',
  'nd-158-2025': '158_2025_ND-CP_25062025-signed.pdf',
  'nd-159-2025': '159_2025_ND-CP_25062025-signed.pdf',
  'nd-188-2025': '188_2025_ND-CP_01072025-signed.pdf',
} as const;

export type CorpusDocumentId = keyof typeof PDF_BY_DOCUMENT_ID;

export function getCorpusPdfFilename(documentId: string): string | null {
  return PDF_BY_DOCUMENT_ID[documentId as CorpusDocumentId] ?? null;
}

export function getCorpusPdfPath(filename: string): string | null {
  if (!Object.values(PDF_BY_DOCUMENT_ID).includes(filename as (typeof PDF_BY_DOCUMENT_ID)[CorpusDocumentId])) {
    return null;
  }
  return join(CORPUS_DIRECTORY, filename);
}

export function getCorpusPdfUrl(documentId: string, page?: number): string | null {
  const filename = getCorpusPdfFilename(documentId);
  if (!filename) return null;
  return `/corpus/${filename}${page ? `#page=${page}` : ''}`;
}

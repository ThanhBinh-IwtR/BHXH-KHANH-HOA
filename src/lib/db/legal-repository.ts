import type { LegalChunk, RetrievedChunk, SearchQuery } from '@/features/legal-rag/types';

export interface LegalDocument {
  documentId: string;
  documentNumber: string;
  documentType: string;
  title: string;
  issuedDate: string;
  effectiveDate: string;
  corpusVersion: string;
  pdfUrl: string;
}

export interface ExactReference {
  documentNumber: string;
  article: string;
  clause?: string | null;
  point?: string | null;
}

/**
 * The single boundary between the RAG business logic and any storage engine.
 * Every method returns the same result shapes for the in-memory and Supabase
 * implementations so behaviour can be tested without Docker or credentials.
 */
export interface LegalRepository {
  getDocuments(): Promise<readonly LegalDocument[]>;
  getSource(chunkId: string): Promise<LegalChunk | null>;
  exactSearch(reference: ExactReference): Promise<readonly LegalChunk[]>;
  keywordSearch(query: string, limit: number): Promise<readonly RetrievedChunk[]>;
  hybridSearch(input: SearchQuery): Promise<readonly RetrievedChunk[]>;
  getRelated(chunkIds: readonly string[]): Promise<readonly LegalChunk[]>;
}

/** Thrown when a storage backend is unreachable, without leaking provider detail. */
export class RepositoryUnavailableError extends Error {
  constructor(message = 'Legal repository is temporarily unavailable') {
    super(message);
    this.name = 'RepositoryUnavailableError';
  }
}

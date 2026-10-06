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

export interface RepositoryCallOptions {
  /**
   * Request cancellation and deadline. Implementations must stop the storage
   * call (not merely ignore its result) and reject when it aborts.
   */
  signal?: AbortSignal;
}

/**
 * The single boundary between the RAG business logic and any storage engine.
 * Every method returns the same result shapes for the in-memory and Supabase
 * implementations so behaviour can be tested without Docker or credentials.
 */
export interface LegalRepository {
  getDocuments(options?: RepositoryCallOptions): Promise<readonly LegalDocument[]>;
  getSource(chunkId: string, options?: RepositoryCallOptions): Promise<LegalChunk | null>;
  exactSearch(
    reference: ExactReference,
    options?: RepositoryCallOptions,
  ): Promise<readonly LegalChunk[]>;
  keywordSearch(
    query: string,
    limit: number,
    options?: RepositoryCallOptions,
  ): Promise<readonly RetrievedChunk[]>;
  hybridSearch(
    input: SearchQuery,
    options?: RepositoryCallOptions,
  ): Promise<readonly RetrievedChunk[]>;
  getRelated(
    chunkIds: readonly string[],
    options?: RepositoryCallOptions,
  ): Promise<readonly LegalChunk[]>;
}

/** Thrown when a storage backend is unreachable, without leaking provider detail. */
export class RepositoryUnavailableError extends Error {
  constructor(message = 'Legal repository is temporarily unavailable') {
    super(message);
    this.name = 'RepositoryUnavailableError';
  }
}

/** Reject a repository call whose request was already cancelled or timed out. */
export function throwIfRepositoryCallAborted(options: RepositoryCallOptions = {}): void {
  if (options.signal?.aborted) {
    throw new RepositoryUnavailableError('Legal repository call was cancelled');
  }
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { LegalChunk, RetrievedChunk, SearchQuery } from '@/features/legal-rag/types';

import {
  RepositoryUnavailableError,
  throwIfRepositoryCallAborted,
  type ExactReference,
  type LegalDocument,
  type LegalRepository,
  type RepositoryCallOptions,
} from './legal-repository';
import { removeAccents } from './text';

/**
 * Columns of the `legal_chunk_rows` view. The view joins the document number
 * and title (which `legal_chunks` does not store) and never exposes the
 * 1024-dimension `embedding` column, so no vector payload crosses the network.
 */
const CHUNK_COLUMNS = [
  'chunk_id',
  'document_id',
  'document_number',
  'document_title',
  'context_header',
  'body_text',
  'search_text',
  'search_text_unaccented',
  'chapter_number',
  'section_number',
  'article_number',
  'article_title',
  'clause_number',
  'point_from',
  'point_to',
  'page_from',
  'page_to',
  'parent_id',
  'previous_sibling_id',
  'next_sibling_id',
  'cross_reference_ids',
  'token_count',
  'corpus_version',
  'chunk_type',
].join(', ');

const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const DOCUMENTS_CACHE_TTL_MS = 5 * 60_000;

const chunkRowSchema = z.object({
  chunk_id: z.string(),
  document_id: z.string(),
  document_number: z.string(),
  document_title: z.string(),
  context_header: z.string(),
  body_text: z.string(),
  search_text: z.string(),
  search_text_unaccented: z.string(),
  chapter_number: z.string().nullable(),
  section_number: z.string().nullable(),
  article_number: z.string().nullable(),
  article_title: z.string().nullable(),
  clause_number: z.string().nullable(),
  point_from: z.string().nullable(),
  point_to: z.string().nullable(),
  page_from: z.number(),
  page_to: z.number(),
  parent_id: z.string().nullable(),
  previous_sibling_id: z.string().nullable(),
  next_sibling_id: z.string().nullable(),
  cross_reference_ids: z.array(z.string()).nullable().default([]),
  token_count: z.number(),
  corpus_version: z.string(),
  chunk_type: z.enum(['normative', 'appendix']).default('normative'),
});

const rankedRowSchema = chunkRowSchema.extend({
  keyword_rank: z.number().nullable().default(null),
  vector_rank: z.number().nullable().default(null),
  fused_score: z.number().nullable().default(null),
});

const documentRowSchema = z.object({
  document_id: z.string(),
  document_number: z.string(),
  document_type: z.string(),
  title: z.string(),
  issued_date: z.string(),
  effective_date: z.string(),
  corpus_version: z.string(),
  pdf_url: z.string(),
});

function toChunk(row: z.infer<typeof chunkRowSchema>): LegalChunk {
  return {
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentNumber: row.document_number,
    documentTitle: row.document_title,
    contextHeader: row.context_header,
    bodyText: row.body_text,
    searchText: row.search_text,
    searchTextUnaccented: row.search_text_unaccented,
    chapterNumber: row.chapter_number,
    sectionNumber: row.section_number,
    articleNumber: row.article_number,
    articleTitle: row.article_title,
    clauseNumber: row.clause_number,
    pointFrom: row.point_from,
    pointTo: row.point_to,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    parentId: row.parent_id,
    previousSiblingId: row.previous_sibling_id,
    nextSiblingId: row.next_sibling_id,
    crossReferenceIds: row.cross_reference_ids ?? [],
    tokenCount: row.token_count,
    corpusVersion: row.corpus_version,
    chunkType: row.chunk_type,
    embedding: null,
  };
}

export interface SupabaseRepositoryOptions {
  url: string;
  serviceKey: string;
  corpusVersion: string;
  client?: SupabaseClient;
  /** Upper bound for one PostgREST call, independent of the request signal. */
  queryTimeoutMs?: number;
  /** Test hook for the documents cache clock. */
  now?: () => number;
}

/**
 * Production repository backed by Supabase PostgreSQL. Every network failure is
 * remapped to RepositoryUnavailableError so provider internals never surface.
 * Every call carries an AbortSignal so a cancelled or timed-out request stops
 * the HTTP call to PostgREST instead of leaving it running in the background.
 */
export class SupabaseLegalRepository implements LegalRepository {
  private readonly client: SupabaseClient;
  private readonly corpusVersion: string;
  private readonly queryTimeoutMs: number;
  private readonly now: () => number;
  private documentsCache: { value: readonly LegalDocument[]; expiresAt: number } | null = null;

  constructor(options: SupabaseRepositoryOptions) {
    this.corpusVersion = options.corpusVersion;
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.client =
      options.client ??
      createClient(options.url, options.serviceKey, {
        auth: { persistSession: false },
      });
  }

  async getDocuments(options?: RepositoryCallOptions): Promise<readonly LegalDocument[]> {
    throwIfRepositoryCallAborted(options);
    // Four nearly static rows: cache them so opening a citation does not cost
    // an extra round-trip. A newly activated corpus appears within the TTL.
    if (this.documentsCache && this.documentsCache.expiresAt > this.now()) {
      return this.documentsCache.value;
    }
    const signal = this.callSignal(options);
    const { data, error } = await this.client
      .from('legal_documents')
      .select(
        'document_id, document_number, document_type, title, issued_date, effective_date, corpus_version, pdf_url',
      )
      .eq('corpus_version', this.corpusVersion)
      .eq('status', 'active')
      .abortSignal(signal);
    if (error) throw this.unavailable(signal);
    const documents = z
      .array(documentRowSchema)
      .parse(data ?? [])
      .map((row) => ({
        documentId: row.document_id,
        documentNumber: row.document_number,
        documentType: row.document_type,
        title: row.title,
        issuedDate: row.issued_date,
        effectiveDate: row.effective_date,
        corpusVersion: row.corpus_version,
        pdfUrl: row.pdf_url,
      }));
    this.documentsCache = { value: documents, expiresAt: this.now() + DOCUMENTS_CACHE_TTL_MS };
    return documents;
  }

  async getSource(chunkId: string, options?: RepositoryCallOptions): Promise<LegalChunk | null> {
    const signal = this.callSignal(options);
    const { data, error } = await this.client
      .from('legal_chunk_rows')
      .select(CHUNK_COLUMNS)
      .eq('chunk_id', chunkId)
      .eq('status', 'active')
      .abortSignal(signal)
      .maybeSingle();
    if (error) throw this.unavailable(signal);
    if (!data) return null;
    return toChunk(chunkRowSchema.parse(data));
  }

  async exactSearch(
    reference: ExactReference,
    options?: RepositoryCallOptions,
  ): Promise<readonly LegalChunk[]> {
    const signal = this.callSignal(options);
    const { data, error } = await this.client
      .rpc('exact_search_legal_chunks', {
        document_number: reference.documentNumber,
        article_number: reference.article,
        clause_number: reference.clause ?? null,
        point_number: reference.point ?? null,
        corpus_version: this.corpusVersion,
      })
      .abortSignal(signal);
    if (error) throw this.unavailable(signal);
    return z
      .array(chunkRowSchema)
      .parse(data ?? [])
      .map(toChunk);
  }

  async keywordSearch(
    query: string,
    limit: number,
    options?: RepositoryCallOptions,
  ): Promise<readonly RetrievedChunk[]> {
    const signal = this.callSignal(options);
    const { data, error } = await this.client
      .rpc('keyword_search_legal_chunks', {
        query_text: query,
        query_unaccented: removeAccents(query),
        match_count: limit,
        corpus_version: this.corpusVersion,
      })
      .abortSignal(signal);
    if (error) throw this.unavailable(signal);
    return z
      .array(rankedRowSchema)
      .parse(data ?? [])
      .map((row, index) => ({
        chunk: toChunk(row),
        exactMatch: false,
        keywordRank: row.keyword_rank ?? index + 1,
        vectorRank: null,
        fusedScore: row.fused_score ?? 1 / (index + 1),
        rerankerScore: null,
      }));
  }

  async hybridSearch(
    input: SearchQuery,
    options?: RepositoryCallOptions,
  ): Promise<readonly RetrievedChunk[]> {
    const signal = this.callSignal(options);
    const { data, error } = await this.client
      .rpc('hybrid_search_legal_chunks', {
        query_text: input.queryText,
        query_unaccented: input.queryUnaccented,
        query_embedding: input.queryVector ?? null,
        match_count: input.matchCount,
        corpus_version: input.corpusVersion,
      })
      .abortSignal(signal);
    if (error) throw this.unavailable(signal);
    return z
      .array(rankedRowSchema)
      .parse(data ?? [])
      .map((row) => ({
        chunk: toChunk(row),
        exactMatch: false,
        keywordRank: row.keyword_rank,
        vectorRank: row.vector_rank,
        fusedScore: row.fused_score ?? 0,
        rerankerScore: null,
      }));
  }

  async getRelated(
    chunkIds: readonly string[],
    options?: RepositoryCallOptions,
  ): Promise<readonly LegalChunk[]> {
    throwIfRepositoryCallAborted(options);
    if (chunkIds.length === 0) return [];
    const signal = this.callSignal(options);
    const { data, error } = await this.client
      .from('legal_chunk_rows')
      .select(CHUNK_COLUMNS)
      .in('chunk_id', [...chunkIds])
      .eq('status', 'active')
      .abortSignal(signal);
    if (error) throw this.unavailable(signal);
    return z
      .array(chunkRowSchema)
      .parse(data ?? [])
      .map(toChunk);
  }

  /** Combine the request signal with a per-call ceiling. */
  private callSignal(options: RepositoryCallOptions = {}): AbortSignal {
    throwIfRepositoryCallAborted(options);
    const timeout = AbortSignal.timeout(this.queryTimeoutMs);
    return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  }

  private unavailable(signal: AbortSignal): RepositoryUnavailableError {
    return new RepositoryUnavailableError(
      signal.aborted
        ? 'Legal repository call was cancelled or timed out'
        : 'Legal repository is temporarily unavailable',
    );
  }
}

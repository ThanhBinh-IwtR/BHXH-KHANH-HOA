import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { LegalChunk, RetrievedChunk, SearchQuery } from '@/features/legal-rag/types';

import {
  RepositoryUnavailableError,
  type ExactReference,
  type LegalDocument,
  type LegalRepository,
} from './legal-repository';
import { removeAccents } from './text';

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
}

/**
 * Production repository backed by Supabase PostgreSQL. Every network failure is
 * remapped to RepositoryUnavailableError so provider internals never surface.
 */
export class SupabaseLegalRepository implements LegalRepository {
  private readonly client: SupabaseClient;
  private readonly corpusVersion: string;

  constructor(options: SupabaseRepositoryOptions) {
    this.corpusVersion = options.corpusVersion;
    this.client =
      options.client ??
      createClient(options.url, options.serviceKey, {
        auth: { persistSession: false },
      });
  }

  async getDocuments(): Promise<readonly LegalDocument[]> {
    const { data, error } = await this.client
      .from('legal_documents')
      .select(
        'document_id, document_number, document_type, title, issued_date, effective_date, corpus_version, pdf_url',
      )
      .eq('corpus_version', this.corpusVersion);
    if (error) throw new RepositoryUnavailableError();
    return z
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
  }

  async getSource(chunkId: string): Promise<LegalChunk | null> {
    const { data, error } = await this.client
      .from('legal_chunks')
      .select('*')
      .eq('chunk_id', chunkId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw new RepositoryUnavailableError();
    if (!data) return null;
    return toChunk(chunkRowSchema.parse(data));
  }

  async exactSearch(reference: ExactReference): Promise<readonly LegalChunk[]> {
    const { data, error } = await this.client.rpc('exact_search_legal_chunks', {
      document_number: reference.documentNumber,
      article_number: reference.article,
      clause_number: reference.clause ?? null,
      point_number: reference.point ?? null,
      corpus_version: this.corpusVersion,
    });
    if (error) throw new RepositoryUnavailableError();
    return z
      .array(chunkRowSchema)
      .parse(data ?? [])
      .map(toChunk);
  }

  async keywordSearch(query: string, limit: number): Promise<readonly RetrievedChunk[]> {
    const { data, error } = await this.client.rpc('keyword_search_legal_chunks', {
      query_text: query,
      query_unaccented: removeAccents(query),
      match_count: limit,
      corpus_version: this.corpusVersion,
    });
    if (error) throw new RepositoryUnavailableError();
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

  async hybridSearch(input: SearchQuery): Promise<readonly RetrievedChunk[]> {
    const { data, error } = await this.client.rpc('hybrid_search_legal_chunks', {
      query_text: input.queryText,
      query_unaccented: input.queryUnaccented,
      query_embedding: input.queryVector ?? null,
      match_count: input.matchCount,
      corpus_version: input.corpusVersion,
    });
    if (error) throw new RepositoryUnavailableError();
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

  async getRelated(chunkIds: readonly string[]): Promise<readonly LegalChunk[]> {
    if (chunkIds.length === 0) return [];
    const { data, error } = await this.client
      .from('legal_chunks')
      .select('*')
      .in('chunk_id', [...chunkIds])
      .eq('status', 'active');
    if (error) throw new RepositoryUnavailableError();
    return z
      .array(chunkRowSchema)
      .parse(data ?? [])
      .map(toChunk);
  }
}

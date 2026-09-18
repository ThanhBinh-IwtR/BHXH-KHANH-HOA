import type { LegalChunk, RetrievedChunk, SearchQuery } from '@/features/legal-rag/types';

import type { ExactReference, LegalDocument, LegalRepository } from './legal-repository';
import { compareLegalChunks, removeAccents } from './text';

export interface LegalCorpusData {
  documents: readonly LegalDocument[];
  chunks: readonly LegalChunk[];
}

/**
 * Deterministic in-memory repository used for local development and every
 * unit/integration test. It intentionally mirrors the ordering rules of the
 * Supabase RPC so that swapping backends never changes observable behaviour.
 */
export class MemoryLegalRepository implements LegalRepository {
  private readonly documents: readonly LegalDocument[];
  private readonly chunks: readonly LegalChunk[];
  private readonly byId: Map<string, LegalChunk>;

  constructor(data: LegalCorpusData) {
    this.documents = [...data.documents];
    this.chunks = [...data.chunks];
    this.byId = new Map(this.chunks.map((chunk) => [chunk.chunkId, chunk]));
  }

  async getDocuments(): Promise<readonly LegalDocument[]> {
    return [...this.documents].sort((a, b) => (a.documentNumber < b.documentNumber ? -1 : 1));
  }

  async getSource(chunkId: string): Promise<LegalChunk | null> {
    return this.byId.get(chunkId) ?? null;
  }

  async exactSearch(reference: ExactReference): Promise<readonly LegalChunk[]> {
    const normalizedDoc = normalizeDocumentNumber(reference.documentNumber);
    const matches = this.chunks.filter((chunk) => {
      if (chunk.chunkType === 'appendix') return false;
      if (normalizeDocumentNumber(chunk.documentNumber) !== normalizedDoc) return false;
      if (chunk.articleNumber !== reference.article) return false;
      if (reference.clause != null && chunk.clauseNumber !== reference.clause) return false;
      if (reference.point != null && !pointInRange(chunk, reference.point)) return false;
      return true;
    });
    return [...matches].sort(compareLegalChunks);
  }

  async keywordSearch(query: string, limit: number): Promise<readonly RetrievedChunk[]> {
    const scored = this.scoreKeyword(query);
    return scored.slice(0, limit).map(({ chunk }, index) => ({
      chunk,
      exactMatch: false,
      keywordRank: index + 1,
      vectorRank: null,
      fusedScore: 1 / (index + 1),
      rerankerScore: null,
    }));
  }

  async hybridSearch(input: SearchQuery): Promise<readonly RetrievedChunk[]> {
    const keyword = this.scoreKeyword(input.queryText, input.corpusVersion);
    const keywordRankById = new Map(keyword.map(({ chunk }, index) => [chunk.chunkId, index + 1]));

    const vectorRankById = new Map<string, number>();
    if (input.queryVector && input.queryVector.length > 0) {
      const ranked = this.chunks
        .filter(
          (chunk) =>
            chunk.chunkType !== 'appendix' &&
            matchesVersion(chunk, input.corpusVersion) &&
            chunk.embedding,
        )
        .map((chunk) => ({ chunk, score: cosine(input.queryVector!, chunk.embedding!) }))
        .sort((a, b) => b.score - a.score);
      ranked.forEach(({ chunk }, index) => vectorRankById.set(chunk.chunkId, index + 1));
    }

    const k = 60;
    const ids = new Set<string>([...keywordRankById.keys(), ...vectorRankById.keys()]);
    const fused: RetrievedChunk[] = [];
    for (const id of ids) {
      const chunk = this.byId.get(id);
      if (!chunk) continue;
      const keywordRank = keywordRankById.get(id) ?? null;
      const vectorRank = vectorRankById.get(id) ?? null;
      const fusedScore =
        (keywordRank ? 1 / (k + keywordRank) : 0) + (vectorRank ? 1 / (k + vectorRank) : 0);
      fused.push({ chunk, exactMatch: false, keywordRank, vectorRank, fusedScore, rerankerScore: null });
    }
    fused.sort((a, b) => b.fusedScore - a.fusedScore || compareLegalChunks(a.chunk, b.chunk));
    return fused.slice(0, input.matchCount);
  }

  async getRelated(chunkIds: readonly string[]): Promise<readonly LegalChunk[]> {
    const result: LegalChunk[] = [];
    const seen = new Set<string>();
    for (const id of chunkIds) {
      const chunk = this.byId.get(id);
      if (chunk && chunk.chunkType !== 'appendix' && !seen.has(chunk.chunkId)) {
        seen.add(chunk.chunkId);
        result.push(chunk);
      }
    }
    return result.sort(compareLegalChunks);
  }

  private scoreKeyword(
    query: string,
    corpusVersion?: string,
  ): { chunk: LegalChunk; score: number }[] {
    // Only meaningful (>=3 char) terms count, and a chunk must match at least two
    // distinct terms to qualify. This mirrors the AND-leaning full-text query in
    // SQL and keeps a single common word ("mức", "bảo") from matching everything.
    const terms = [...new Set(removeAccents(query).split(/\s+/).filter((term) => term.length >= 2))];
    if (terms.length === 0) return [];
    const minScore = Math.min(2, terms.length);
    const scored: { chunk: LegalChunk; score: number }[] = [];
    for (const chunk of this.chunks) {
      if (chunk.chunkType === 'appendix') continue;
      if (corpusVersion && !matchesVersion(chunk, corpusVersion)) continue;
      // Whole-token matching: "thu" must not match inside "thuoc".
      const tokens = new Set(chunk.searchTextUnaccented.split(/[^a-z0-9]+/));
      let score = 0;
      for (const term of terms) {
        if (tokens.has(term)) score += 1;
      }
      if (score >= minScore) scored.push({ chunk, score });
    }
    return scored.sort(
      (a, b) => b.score - a.score || compareLegalChunks(a.chunk, b.chunk),
    );
  }
}

function matchesVersion(chunk: LegalChunk, corpusVersion: string): boolean {
  return chunk.corpusVersion === corpusVersion;
}

function normalizeDocumentNumber(value: string): string {
  return removeAccents(value).replace(/\s+/g, '').replace(/-/g, '');
}

function pointInRange(chunk: LegalChunk, point: string): boolean {
  const from = chunk.pointFrom;
  const to = chunk.pointTo ?? chunk.pointFrom;
  if (from == null || to == null) return false;
  return point >= from && point <= to;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

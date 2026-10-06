import { ProviderUnavailableError } from '@/lib/ai/errors';
import type { EmbeddingClient, RerankerClient } from '@/lib/ai/contracts';
import { RepositoryUnavailableError, type LegalRepository } from '@/lib/db/legal-repository';
import { removeAccents } from '@/lib/db/text';

import { parseLegalReference, type LegalReference } from './query-parser';
import { reciprocalRankFusion } from './rank-fusion';
import {
  runWithinStageBudget,
  StageBudgetExceededError,
  type RequestBudget,
} from './request-budget';
import type { RetrievedChunk } from './types';

export interface RetrievalRequest {
  query: string;
  corpusVersion: string;
}

export interface EvidenceSet {
  reference: LegalReference | null;
  chunks: readonly RetrievedChunk[];
  usedKeywordFallback: boolean;
  rerankerFailed: boolean;
  /** Non-sensitive reasons why semantic retrieval was degraded. */
  degradedReasons?: readonly string[];
  evidenceStrength: 'exact' | 'keyword' | 'weak';
  hasAcceptableEvidence: boolean;
}

export interface RetrievalOptions {
  /** Request cancellation/deadline, forwarded to providers and the repository. */
  signal?: AbortSignal;
  /**
   * Request budget. When present, embedding and reranking each run under their
   * own stage budget and are skipped when they would starve generation.
   */
  budget?: Pick<RequestBudget, 'auxiliaryStageMs'>;
}

const CANDIDATE_COUNT = 30;
const FUSION_LIMIT = 20;
const FINAL_LIMIT = 10;
const CORPUS_ANCHOR_WORDS = new Set(['bhxh', 'bhyt', 'dieu', 'khoan', 'luat', 'quy']);
const CORPUS_ANCHOR_PHRASES = [
  'bao hiem',
  'nghi dinh',
  'muc dong',
  'ty le',
  'nguoi lao dong',
  'huu tri',
  'tu tuat',
  'doi tuong',
];

export async function retrieveEvidence(
  request: RetrievalRequest,
  repository: LegalRepository,
  embedder: EmbeddingClient,
  reranker: RerankerClient,
  options: RetrievalOptions = {},
): Promise<EvidenceSet> {
  const query = request.query.normalize('NFC');
  const reference = parseLegalReference(query);
  const repositoryOptions = { signal: options.signal };
  const exact = reference ? await repository.exactSearch(reference, repositoryOptions) : [];

  // An explicit legal coordinate is already a deterministic retrieval result.
  // Avoid spending provider latency (and a second failure surface) on a
  // semantic search that cannot improve the exact answer.
  if (exact.length > 0) {
    return {
      reference,
      chunks: exact.map((chunk) => ({
        chunk,
        exactMatch: true,
        keywordRank: null,
        vectorRank: null,
        fusedScore: Number.POSITIVE_INFINITY,
        rerankerScore: null,
      })),
      usedKeywordFallback: false,
      rerankerFailed: false,
      degradedReasons: [],
      evidenceStrength: 'exact',
      hasAcceptableEvidence: true,
    };
  }

  let hybrid: readonly RetrievedChunk[] = [];
  let usedKeywordFallback = false;
  const degradedReasons: string[] = [];
  try {
    const queryVector = await embedQuery(query, embedder, options);
    hybrid = await repository.hybridSearch(
      {
        queryText: query,
        queryUnaccented: removeAccents(query),
        queryVector,
        matchCount: CANDIDATE_COUNT,
        corpusVersion: request.corpusVersion,
      },
      repositoryOptions,
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (!(error instanceof ProviderUnavailableError) && !(error instanceof RepositoryUnavailableError)) {
      throw error;
    }
    if (exact.length === 0) {
      hybrid = await repository.keywordSearch(query, CANDIDATE_COUNT, repositoryOptions);
      usedKeywordFallback = true;
      degradedReasons.push(
        error instanceof EmbeddingSkippedError
          ? 'embedding_skipped_budget'
          : error instanceof StageBudgetExceededError
            ? 'embedding_timeout_keyword_fallback'
            : 'embedding_unavailable_keyword_fallback',
      );
    }
  }

  const byId = new Map<string, RetrievedChunk>();
  for (const chunk of exact) {
    byId.set(chunk.chunkId, {
      chunk,
      exactMatch: true,
      keywordRank: null,
      vectorRank: null,
      fusedScore: Number.POSITIVE_INFINITY,
      rerankerScore: null,
    });
  }
  for (const retrieved of hybrid) {
    if (!byId.has(retrieved.chunk.chunkId)) byId.set(retrieved.chunk.chunkId, retrieved);
  }

  const fused = reciprocalRankFusion({
    exact: exact.map((chunk) => chunk.chunkId),
    hybrid: hybrid.map((retrieved) => retrieved.chunk.chunkId),
  });

  const ordered = fused
    .slice(0, FUSION_LIMIT)
    .map((result) => byId.get(result.id))
    .filter((value): value is RetrievedChunk => value !== undefined);

  // Hybrid/vector retrieval can surface a neighbouring BHXH rule for a broad
  // phrase such as "mức đóng bảo hiểm". Keep a topic-specific query from
  // handing that unrelated rule to the generator as additional context.
  const topicRelevant = filterTopicRelevant(ordered, query);
  const candidates = topicRelevant.length > 0 ? topicRelevant : ordered;
  const { chunks, rerankerFailed, reason: rerankReason } = await rerankOrKeepOrder(
    query,
    candidates,
    reranker,
    options,
  );
  if (rerankReason) degradedReasons.push(rerankReason);
  const finalChunks = chunks.slice(0, FINAL_LIMIT);
  // MVP threshold: non-exact evidence must have a real lexical rank in the
  // top five. Vector-only hits are useful candidates but not strong enough to
  // justify a legal conclusion without a matching term or explicit coordinate.
  const hasCorpusAnchor = containsCorpusAnchor(query);
  const hasKeywordEvidence =
    hasCorpusAnchor &&
    finalChunks.some(
      (retrieved) => retrieved.keywordRank !== null && retrieved.keywordRank <= 5,
    );
  return {
    reference,
    chunks: finalChunks,
    usedKeywordFallback,
    rerankerFailed,
    degradedReasons,
    evidenceStrength: hasKeywordEvidence ? 'keyword' : 'weak',
    hasAcceptableEvidence: hasKeywordEvidence,
  };
}

function filterTopicRelevant(
  chunks: readonly RetrievedChunk[],
  query: string,
): readonly RetrievedChunk[] {
  const normalizedQuery = removeAccents(query).toLowerCase();
  const mentionsBhyt = normalizedQuery.includes('bao hiem y te') || normalizedQuery.includes('bhyt');
  const mentionsBhxh = normalizedQuery.includes('bao hiem xa hoi') || normalizedQuery.includes('bhxh');
  const isComparison = mentionsBhyt && mentionsBhxh;
  const requiredDomain = isComparison
    ? null
    : mentionsBhyt
    ? 'bao hiem y te'
    : mentionsBhxh
      ? 'bao hiem xa hoi'
      : null;
  const qualifiers = (isComparison ? [] : ['tu nguyen', 'bat buoc', 'nguoi su dung lao dong'])
    .filter((qualifier) => normalizedQuery.includes(qualifier));

  if (!requiredDomain && qualifiers.length === 0) return chunks;
  return chunks.filter((retrieved) => {
    const text = removeAccents(
      `${retrieved.chunk.searchText} ${retrieved.chunk.bodyText}`,
    ).toLowerCase();
    if (requiredDomain && !text.includes(requiredDomain)) return false;
    return qualifiers.every((qualifier) => text.includes(qualifier));
  });
}

function containsCorpusAnchor(query: string): boolean {
  const normalized = removeAccents(query).toLowerCase();
  const tokens = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));
  return (
    [...CORPUS_ANCHOR_WORDS].some((word) => tokens.has(word)) ||
    CORPUS_ANCHOR_PHRASES.some((phrase) => normalized.includes(phrase))
  );
}

/** Raised internally when no budget is left for the optional embedding stage. */
class EmbeddingSkippedError extends ProviderUnavailableError {}

async function embedQuery(
  query: string,
  embedder: EmbeddingClient,
  options: RetrievalOptions,
): Promise<readonly number[] | null> {
  if (!options.budget) {
    const [vector] = await embedder.embed([query], { signal: options.signal });
    return vector ?? null;
  }
  const budgetMs = options.budget.auxiliaryStageMs();
  if (budgetMs <= 0) throw new EmbeddingSkippedError('No budget left for query embedding');
  const [vector] = await runWithinStageBudget('embedding', budgetMs, options.signal, (signal) =>
    embedder.embed([query], { signal, timeoutMs: budgetMs }),
  );
  return vector ?? null;
}

async function rerankOrKeepOrder(
  query: string,
  chunks: readonly RetrievedChunk[],
  reranker: RerankerClient,
  options: RetrievalOptions,
): Promise<{ chunks: readonly RetrievedChunk[]; rerankerFailed: boolean; reason?: string }> {
  if (chunks.length === 0) return { chunks, rerankerFailed: false };
  const passages = chunks.map((retrieved) => retrieved.chunk.searchText);
  const budgetMs = options.budget?.auxiliaryStageMs();
  // Reranking only refines the order. When the remaining request time must be
  // kept for generation, keep the rank-fusion order instead of risking a blank
  // failure after the whole budget was spent on an optional stage.
  if (budgetMs !== undefined && budgetMs <= 0) {
    return { chunks, rerankerFailed: true, reason: 'reranker_skipped_budget' };
  }
  try {
    const scores =
      budgetMs === undefined
        ? await reranker.rerank(query, passages, { signal: options.signal })
        : await runWithinStageBudget('reranking', budgetMs, options.signal, (signal) =>
            reranker.rerank(query, passages, { signal, timeoutMs: budgetMs }),
          );
    const scored = chunks.map((retrieved, index) => ({
      ...retrieved,
      rerankerScore: scores[index] ?? 0,
    }));
    // Exact matches stay pinned; only fused candidates are reordered by score.
    const exactMatches = scored.filter((chunk) => chunk.exactMatch);
    const rest = scored
      .filter((chunk) => !chunk.exactMatch)
      .sort((a, b) => (b.rerankerScore ?? 0) - (a.rerankerScore ?? 0));
    return { chunks: [...exactMatches, ...rest], rerankerFailed: false };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (!(error instanceof ProviderUnavailableError)) throw error;
    return {
      chunks,
      rerankerFailed: true,
      reason:
        error instanceof StageBudgetExceededError
          ? 'reranker_timeout_order_preserved'
          : 'reranker_unavailable_order_preserved',
    };
  }
}

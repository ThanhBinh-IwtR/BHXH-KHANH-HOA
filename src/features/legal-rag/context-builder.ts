import type { LegalRepository, RepositoryCallOptions } from '@/lib/db/legal-repository';
import { compareLegalChunks } from '@/lib/db/text';

import type { EvidenceSet } from './retrieval';
import type { LegalChunk } from './types';

export interface ContextBudget {
  /** Approximate token ceiling for the assembled context. */
  maxTokens: number;
}

export interface ContextSource {
  chunkId: string;
  documentNumber: string;
  label: string;
  bodyText: string;
  pageFrom: number;
  pageTo: number;
}

export interface BuiltContext {
  sources: readonly ContextSource[];
  sourceIds: readonly string[];
  contextText: string;
  tokenEstimate: number;
}

const DEFAULT_BUDGET: ContextBudget = { maxTokens: 3200 };

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function label(chunk: LegalChunk): string {
  const parts = [chunk.documentNumber];
  if (chunk.articleNumber) parts.push(`Điều ${chunk.articleNumber}`);
  if (chunk.clauseNumber) parts.push(`Khoản ${chunk.clauseNumber}`);
  if (chunk.pointFrom) {
    parts.push(
      chunk.pointTo && chunk.pointTo !== chunk.pointFrom
        ? `Điểm ${chunk.pointFrom}-${chunk.pointTo}`
        : `Điểm ${chunk.pointFrom}`,
    );
  }
  return parts.join(' · ');
}

/**
 * Expand retrieved evidence with parent headers, siblings and cited articles,
 * deterministically deduplicated and ordered, without ever crossing the budget.
 */
export async function buildContext(
  evidence: EvidenceSet,
  repository: LegalRepository,
  budget: ContextBudget = DEFAULT_BUDGET,
  options: RepositoryCallOptions = {},
): Promise<BuiltContext> {
  const primary = evidence.chunks.map((retrieved) => retrieved.chunk);

  const relatedIds = new Set<string>();
  for (const chunk of primary) {
    for (const id of [
      chunk.parentId,
      chunk.previousSiblingId,
      chunk.nextSiblingId,
      ...chunk.crossReferenceIds,
    ]) {
      if (id) relatedIds.add(id);
    }
  }
  for (const chunk of primary) relatedIds.delete(chunk.chunkId);

  const primaryDocumentIds = new Set(primary.map((chunk) => chunk.documentId));
  const primaryCorpusVersions = new Set(primary.map((chunk) => chunk.corpusVersion));
  const relatedCandidates = relatedIds.size > 0 ? await repository.getRelated([...relatedIds], options) : [];
  const related = relatedCandidates.filter(
    (chunk) =>
      chunk.chunkType !== 'appendix' &&
      primaryDocumentIds.has(chunk.documentId) &&
      primaryCorpusVersions.has(chunk.corpusVersion),
  );

  const selected: LegalChunk[] = [];
  const seen = new Set<string>();
  let tokenEstimate = 0;

  const consider = (chunk: LegalChunk): void => {
    if (seen.has(chunk.chunkId)) return;
    const cost = estimateTokens(chunk.searchText);
    if (tokenEstimate + cost > budget.maxTokens) return;
    seen.add(chunk.chunkId);
    selected.push(chunk);
    tokenEstimate += cost;
  };

  // Primary evidence first (retrieval order), then legal-relation expansion.
  for (const chunk of primary) consider(chunk);
  for (const chunk of related) consider(chunk);

  selected.sort(compareLegalChunks);

  const sources: ContextSource[] = selected.map((chunk) => ({
    chunkId: chunk.chunkId,
    documentNumber: chunk.documentNumber,
    label: label(chunk),
    bodyText: chunk.bodyText,
    pageFrom: chunk.pageFrom,
    pageTo: chunk.pageTo,
  }));

  const contextText = selected
    .map((chunk) => `[${chunk.chunkId}] ${chunk.contextHeader}\n${chunk.bodyText}`)
    .join('\n\n');

  return {
    sources,
    sourceIds: selected.map((chunk) => chunk.chunkId),
    contextText,
    tokenEstimate,
  };
}

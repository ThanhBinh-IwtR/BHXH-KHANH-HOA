import type { BuiltContext, ContextSource } from './context-builder';
import type { ScopeStatus, VerifiedAnswer } from './types';

export const AI_ACCURACY_NOTICE =
  'Nội dung do AI hỗ trợ có thể có sai sót; vui lòng đối chiếu văn bản gốc tại các căn cứ đính kèm.';

export interface Citation {
  sourceId: string;
  label: string;
}

export interface PublicClaim {
  claim: string;
  citations: Citation[];
}

export interface PublicSource {
  sourceId: string;
  label: string;
  documentNumber: string;
  pageFrom: number;
  pageTo: number;
}

export interface PublicResponse {
  scopeStatus: ScopeStatus;
  shortAnswer: string;
  shortAnswerCitations?: Citation[];
  analysis: PublicClaim[];
  aiSupplement: string | null;
  missingInformation: string[];
  followUpQuestion: string | null;
  sources: PublicSource[];
}

/**
 * Map an internally verified answer to the public API contract. Only sources
 * that survived verification and appear in a claim are exposed; similarity
 * scores and internal ranks are never serialised.
 */
export function buildPublicResponse(
  verified: VerifiedAnswer,
  context: BuiltContext,
): PublicResponse {
  const sourceById = new Map<string, ContextSource>(
    context.sources.map((source) => [source.chunkId, source]),
  );

  const usedIds = new Set<string>();
  const shortAnswerCitations = (verified.shortAnswerSourceIds ?? [])
    .filter((id) => sourceById.has(id))
    .map((id) => {
      usedIds.add(id);
      return { sourceId: id, label: sourceById.get(id)!.label };
    });
  const analysis: PublicClaim[] = verified.analysis.map((claim) => ({
    claim: claim.claim,
    citations: claim.sourceIds
      .filter((id) => sourceById.has(id))
      .map((id) => {
        usedIds.add(id);
        return { sourceId: id, label: sourceById.get(id)!.label };
      }),
  }));

  const sources: PublicSource[] = [...usedIds].map((id) => {
    const source = sourceById.get(id)!;
    return {
      sourceId: id,
      label: source.label,
      documentNumber: source.documentNumber,
      pageFrom: source.pageFrom,
      pageTo: source.pageTo,
    };
  });

  return {
    scopeStatus: verified.scopeStatus,
    shortAnswer: verified.shortAnswer,
    shortAnswerCitations,
    analysis,
    aiSupplement: verified.aiSupplement,
    missingInformation: [...verified.missingInformation],
    followUpQuestion: verified.followUpQuestion,
    sources,
  };
}

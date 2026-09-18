import { z } from 'zod';

import type { EmbeddingClient, LlmClient, RerankerClient } from '@/lib/ai/contracts';
import { InvalidModelOutputError, ProviderUnavailableError } from '@/lib/ai/errors';
import type { LegalRepository } from '@/lib/db/legal-repository';

import type { ModelAnswer } from './answer-schema';
import { generateAnswer } from './answer-generator';
import { ensureGroundedAnswerDepth } from './answer-depth';
import { validateAnswer } from './answer-validator';
import { SAFE_FALLBACK, verifyAnswer } from './answer-verifier';
import { buildContext, type ContextBudget } from './context-builder';
import { buildPublicResponse, type PublicResponse } from './public-response';
import { retrieveEvidence } from './retrieval';
import type { VerifiedAnswer } from './types';
import { parseLegalReference, type LegalReference } from './query-parser';

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(12)
    .default([]),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface RagServiceDeps {
  repository: LegalRepository;
  embedder: EmbeddingClient;
  reranker: RerankerClient;
  generator: LlmClient;
  corpusVersion: string;
  contextBudget?: ContextBudget;
  /** Total orchestration budget. Provider adapters retain their own shorter stage timeout. */
  requestTimeoutMs?: number;
}

export interface RagStageTimings {
  retrievalMs: number;
  contextMs: number;
  generationMs: number;
  verificationMs: number;
  totalMs: number;
}

export type RagStage = 'retrieval' | 'context' | 'generation' | 'verification' | 'orchestration';

export interface RagFailureDiagnostics {
  stage: RagStage;
  stageTimings: RagStageTimings;
}

export interface RagOutcome {
  response: PublicResponse;
  retrievalCount: number;
  stageTimings: RagStageTimings;
  metrics: RagMetrics;
}

export interface RagMetrics {
  /** Number of generator calls, never including a semantic verifier call. */
  llmCallCount: number;
  rejectedClaimCount: number;
  downgradeReasons: readonly string[];
}

export interface RagRunOptions {
  signal?: AbortSignal;
}

const OUT_OF_SCOPE: VerifiedAnswer = SAFE_FALLBACK;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const RAG_FAILURE_DIAGNOSTICS = Symbol('ragFailureDiagnostics');

const FOLLOW_UP_RE = /^(còn|thế|vậy|nó|trường hợp|nếu|và|hơn nữa)\b/i;
const OBVIOUS_OUT_OF_SCOPE_RE = /hộ chiếu|đăng ký kết hôn|thời tiết|chứng khoán/i;
const CORPUS_SIGNAL_RE = /bhxh|bhyt|bảo hiểm|nghị định|điều|khoản|mức đóng|người lao động/i;

/** Deterministically resolve a standalone retrieval question from short history. */
export function resolveStandaloneQuestion(
  message: string,
  history: ChatRequest['history'],
): string {
  const trimmed = message.trim();
  const looksStandalone = trimmed.length > 40 || /\d/.test(trimmed);
  if (looksStandalone && !FOLLOW_UP_RE.test(trimmed)) return trimmed;
  const recent = history.slice(-6);
  const lastUser = [...recent].reverse().find((turn) => turn.role === 'user');
  return lastUser ? `${lastUser.content.trim()} ${trimmed}`.trim() : trimmed;
}

const EMPTY_CONTEXT = { sources: [], sourceIds: [], contextText: '', tokenEstimate: 0 } as const;

/**
 * Orchestrate one turn:
 *   validate -> resolve standalone -> retrieve -> build context ->
 *   generate -> deterministic validate -> deterministic verification -> public response.
 * Any stage without acceptable evidence returns a bounded out_of_scope answer.
 */
export async function runRag(
  request: ChatRequest,
  deps: RagServiceDeps,
  options: RagRunOptions = {},
): Promise<RagOutcome> {
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const started = Date.now();
  return withRequestDeadline(
    (signal) => runRagWithinBudget(request, deps, signal),
    timeoutMs,
    options.signal,
  ).catch((error: unknown) => {
    annotateFailure(error, 'orchestration', {
      retrievalMs: 0,
      contextMs: 0,
      generationMs: 0,
      verificationMs: 0,
    }, started);
    throw error;
  });
}

async function runRagWithinBudget(
  request: ChatRequest,
  deps: RagServiceDeps,
  signal: AbortSignal,
): Promise<RagOutcome> {
  const started = Date.now();
  const stageTimings: Omit<RagStageTimings, 'totalMs'> = {
    retrievalMs: 0,
    contextMs: 0,
    generationMs: 0,
    verificationMs: 0,
  };
  const metrics: { llmCallCount: number; rejectedClaimCount: number; downgradeReasons: string[] } = {
    llmCallCount: 0,
    rejectedClaimCount: 0,
    downgradeReasons: [],
  };
  const standalone = resolveStandaloneQuestion(request.message, request.history);
  const clarification = buildClarificationPreflight(standalone);
  if (clarification) {
    metrics.downgradeReasons.push('clarification_before_generation');
    return finishOutcome(
      buildPublicResponse(clarification, EMPTY_CONTEXT),
      0,
      stageTimings,
      started,
      metrics,
    );
  }
  if (isObviousOutOfScope(standalone)) {
    metrics.downgradeReasons.push('out_of_scope_before_retrieval');
    return finishOutcome(
      buildPublicResponse(OUT_OF_SCOPE, EMPTY_CONTEXT),
      0,
      stageTimings,
      started,
      metrics,
    );
  }

  const retrievalStarted = Date.now();
  let evidence;
  try {
    evidence = await retrieveEvidence(
      { query: standalone, corpusVersion: deps.corpusVersion },
      deps.repository,
      deps.embedder,
      deps.reranker,
      { signal },
    );
    throwIfAborted(signal);
  } catch (error) {
    stageTimings.retrievalMs = Date.now() - retrievalStarted;
    annotateFailure(error, 'retrieval', stageTimings, started);
    throw error;
  }
  stageTimings.retrievalMs = Date.now() - retrievalStarted;
  metrics.downgradeReasons.push(...(evidence.degradedReasons ?? []));

  if (evidence.chunks.length === 0 || !evidence.hasAcceptableEvidence) {
    if (evidence.chunks.length > 0) metrics.downgradeReasons.push('insufficient_evidence');
    return finishOutcome(
      buildPublicResponse(OUT_OF_SCOPE, EMPTY_CONTEXT),
      0,
      stageTimings,
      started,
      metrics,
    );
  }

  const contextStarted = Date.now();
  let context;
  try {
    context = await buildContext(evidence, deps.repository, deps.contextBudget);
    throwIfAborted(signal);
  } catch (error) {
    stageTimings.contextMs = Date.now() - contextStarted;
    annotateFailure(error, 'context', stageTimings, started);
    throw error;
  }
  stageTimings.contextMs = Date.now() - contextStarted;
  if (context.sources.length === 0) {
    metrics.downgradeReasons.push('empty_context');
    return finishOutcome(
      buildPublicResponse(OUT_OF_SCOPE, EMPTY_CONTEXT),
      0,
      stageTimings,
      started,
      metrics,
    );
  }

  const generationStarted = Date.now();
  metrics.llmCallCount += 1;
  let model: ModelAnswer;
  try {
    model = await generateAnswer(standalone, context, deps.generator, { signal });
  } catch (error) {
    stageTimings.generationMs = Date.now() - generationStarted;
    annotateFailure(error, 'generation', stageTimings, started);
    if (!(error instanceof InvalidModelOutputError)) throw error;
    metrics.downgradeReasons.push('invalid_model_output');
    return finishOutcome(
      buildPublicResponse(SAFE_FALLBACK, context),
      evidence.chunks.length,
      stageTimings,
      started,
      metrics,
    );
  }
  throwIfAborted(signal);
  stageTimings.generationMs = Date.now() - generationStarted;
  const validation = validateAnswer(model, context);
  const invalidClaimIndexes = new Set(
    validation.issues
      .filter((issue) => issue.claimIndex >= 0)
      .map((issue) => issue.claimIndex),
  );
  metrics.rejectedClaimCount = invalidClaimIndexes.size;
  metrics.downgradeReasons.push(
    ...new Set(validation.issues.map((issue) => `validator_${issue.code.toLowerCase()}`)),
  );

  if (validation.issues.some((issue) => issue.code === 'INVALID_SHORT_ANSWER')) {
    metrics.downgradeReasons.push('invalid_short_answer');
    return finishOutcome(
      buildPublicResponse(SAFE_FALLBACK, context),
      evidence.chunks.length,
      stageTimings,
      started,
      metrics,
    );
  }

  let candidate: ModelAnswer = model;
  if (!validation.ok) {
    const analysis = model.analysis.filter((_claim, index) => !invalidClaimIndexes.has(index));
    if (model.scope_status === 'grounded' && analysis.length === 0) {
      metrics.downgradeReasons.push('no_supported_claims');
      return finishOutcome(
        buildPublicResponse(SAFE_FALLBACK, context),
        evidence.chunks.length,
        stageTimings,
        started,
        metrics,
      );
    }
    candidate = { ...model, analysis };
  }

  // Validation may remove an unsupported claim after generation. Apply the
  // model-free depth policy to the surviving answer as well, so the public
  // response cannot regress to a shallow two-claim answer. The policy only
  // adds source-backed formula explanations and never calls another model.
  candidate = ensureGroundedAnswerDepth(candidate, context, standalone);
  const depthValidation = validateAnswer(candidate, context);
  const depthInvalidClaimIndexes = new Set(
    depthValidation.issues
      .filter((issue) => issue.claimIndex >= 0)
      .map((issue) => issue.claimIndex),
  );
  if (depthInvalidClaimIndexes.size > 0) {
    metrics.rejectedClaimCount += depthInvalidClaimIndexes.size;
    metrics.downgradeReasons.push(
      ...new Set(depthValidation.issues.map((issue) => `validator_${issue.code.toLowerCase()}`)),
    );
    candidate = {
      ...candidate,
      analysis: candidate.analysis.filter((_claim, index) => !depthInvalidClaimIndexes.has(index)),
    };
  }
  if (
    depthValidation.issues.some((issue) => issue.code === 'INVALID_SHORT_ANSWER') ||
    (candidate.scope_status === 'grounded' && candidate.analysis.length === 0)
  ) {
    metrics.downgradeReasons.push('no_supported_claims');
    return finishOutcome(
      buildPublicResponse(SAFE_FALLBACK, context),
      evidence.chunks.length,
      stageTimings,
      started,
      metrics,
    );
  }

  const verificationStarted = Date.now();
  let verified;
  try {
    verified = verifyAnswer(candidate, context);
    throwIfAborted(signal);
  } catch (error) {
    stageTimings.verificationMs = Date.now() - verificationStarted;
    annotateFailure(error, 'verification', stageTimings, started);
    throw error;
  }
  stageTimings.verificationMs = Date.now() - verificationStarted;
  const canonicalVerified = canonicalizeExplicitReference(verified, standalone, context);
  return finishOutcome(
    buildPublicResponse(canonicalVerified, context),
    evidence.chunks.length,
    stageTimings,
    started,
    metrics,
  );
}

function canonicalizeExplicitReference(
  answer: VerifiedAnswer,
  question: string,
  context: typeof EMPTY_CONTEXT | Awaited<ReturnType<typeof buildContext>>,
): VerifiedAnswer {
  const reference = parseLegalReference(question);
  if (
    !reference ||
    answer.scopeStatus !== 'grounded' ||
    !answer.shortAnswerSourceIds?.some((sourceId) =>
      context.sources.some(
        (source) => source.chunkId === sourceId && sourceMatchesReference(source, reference),
      ),
    )
  ) {
    return answer;
  }

  const marker = /\bquy định(?:\s+rằng)?\s*[:：-]?\s*/i.exec(answer.shortAnswer);
  const substance =
    marker && marker.index < 100
      ? answer.shortAnswer.slice(marker.index + marker[0].length).trim()
      : answer.shortAnswer.trim();
  if (!substance) return answer;

  return {
    ...answer,
    shortAnswer: `${formatLegalReference(reference)} quy định: ${substance}`,
  };
}

function sourceMatchesReference(
  source: { documentNumber: string; label: string },
  reference: LegalReference,
): boolean {
  const parts = new Set(source.label.toLocaleLowerCase('vi').split(' · '));
  return (
    source.documentNumber === reference.documentNumber &&
    parts.has(`điều ${reference.article.toLocaleLowerCase('vi')}`) &&
    (reference.clause === null || parts.has(`khoản ${reference.clause}`)) &&
    (reference.point === null || parts.has(`điểm ${reference.point.toLocaleLowerCase('vi')}`))
  );
}

function formatLegalReference(reference: LegalReference): string {
  const coordinates: string[] = [];
  if (reference.point) coordinates.push(`Điểm ${reference.point}`);
  if (reference.clause) coordinates.push(`Khoản ${reference.clause}`);
  coordinates.push(`Điều ${reference.article}`);
  return `${coordinates.join(' ')} Nghị định ${reference.documentNumber}`;
}

function finishOutcome(
  response: PublicResponse,
  retrievalCount: number,
  stageTimings: Omit<RagStageTimings, 'totalMs'>,
  started: number,
  metrics: RagMetrics,
): RagOutcome {
  return {
    response,
    retrievalCount,
    stageTimings: { ...stageTimings, totalMs: Date.now() - started },
    metrics: {
      llmCallCount: metrics.llmCallCount,
      rejectedClaimCount: metrics.rejectedClaimCount,
      downgradeReasons: [...new Set(metrics.downgradeReasons)],
    },
  };
}

export function getRagFailureDiagnostics(error: unknown): RagFailureDiagnostics | undefined {
  if (!error || typeof error !== 'object') return undefined;
  return (error as { [RAG_FAILURE_DIAGNOSTICS]?: RagFailureDiagnostics })[
    RAG_FAILURE_DIAGNOSTICS
  ];
}

function annotateFailure(
  error: unknown,
  stage: RagStage,
  stageTimings: Omit<RagStageTimings, 'totalMs'>,
  started: number,
): void {
  if (!error || typeof error !== 'object' || getRagFailureDiagnostics(error)) return;
  Object.defineProperty(error, RAG_FAILURE_DIAGNOSTICS, {
    configurable: true,
    enumerable: false,
    value: {
      stage,
      stageTimings: { ...stageTimings, totalMs: Date.now() - started },
    } satisfies RagFailureDiagnostics,
  });
}

function buildClarificationPreflight(question: string): VerifiedAnswer | null {
  const normalized = question.normalize('NFC').toLocaleLowerCase('vi');
  const explicitIntent =
    /(?:^|\s)(?:cần|xin|hãy|vui lòng|bạn có thể)\s+làm rõ(?:\s|$)/.test(normalized) ||
    /(?:^|\s)(?:chưa|không)\s+rõ(?:\s|$)/.test(normalized);
  if (!explicitIntent) return null;

  if (/nhóm đối tượng|đối tượng tham gia/.test(normalized)) {
    return {
      scopeStatus: 'needs_clarification',
      shortAnswer:
        'Để xác định mức đóng chính xác, cần biết bạn thuộc nhóm đối tượng tham gia nào.',
      shortAnswerSourceIds: [],
      analysis: [],
      aiSupplement: null,
      missingInformation: ['Nhóm đối tượng tham gia'],
      followUpQuestion: 'Bạn thuộc nhóm đối tượng nào?',
    };
  }

  if (/loại bảo hiểm|bảo hiểm nào/.test(normalized)) {
    return {
      scopeStatus: 'needs_clarification',
      shortAnswer:
        'Để xác định mức đóng chính xác, cần biết bạn đang hỏi loại bảo hiểm nào.',
      shortAnswerSourceIds: [],
      analysis: [],
      aiSupplement: null,
      missingInformation: ['Loại bảo hiểm đang được hỏi'],
      followUpQuestion: 'Bạn đang hỏi BHXH bắt buộc hay tự nguyện?',
    };
  }

  if (/nghị định|điều|khoản|điểm|mức đóng|tỷ lệ|quyền lợi/.test(normalized)) {
    return null;
  }

  return {
    scopeStatus: 'needs_clarification',
    shortAnswer:
      'Để trả lời chính xác, cần làm rõ loại bảo hiểm, nhóm đối tượng hoặc hoàn cảnh áp dụng.',
    shortAnswerSourceIds: [],
    analysis: [],
    aiSupplement: null,
    missingInformation: ['Loại bảo hiểm, nhóm đối tượng hoặc hoàn cảnh áp dụng'],
    followUpQuestion: 'Bạn đang hỏi về loại bảo hiểm hoặc nhóm đối tượng nào?',
  };
}

function isObviousOutOfScope(question: string): boolean {
  return OBVIOUS_OUT_OF_SCOPE_RE.test(question) && !CORPUS_SIGNAL_RE.test(question);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ProviderUnavailableError('RAG request cancelled', signal.reason);
  }
}

function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const boundedTimeout = Math.max(1, timeoutMs);
  return new Promise<T>((resolve, reject) => {
    if (parentSignal?.aborted) {
      reject(new ProviderUnavailableError('RAG request cancelled', parentSignal.reason));
      return;
    }

    const controller = new AbortController();
    let settled = false;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onParentAbort = () => {
      controller.abort(parentSignal?.reason);
      settle(() => reject(new ProviderUnavailableError('RAG request cancelled', parentSignal?.reason)));
    };

    if (parentSignal) parentSignal.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => {
      const error = new ProviderUnavailableError('RAG request exceeded its total time budget');
      controller.abort(error);
      settle(() => reject(error));
    }, boundedTimeout);

    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      );
  });
}

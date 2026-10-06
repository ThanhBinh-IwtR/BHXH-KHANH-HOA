import { z } from 'zod';

import type { EmbeddingClient, LlmClient, LlmUsage, RerankerClient } from '@/lib/ai/contracts';
import {
  InvalidModelOutputError,
  ModelOutputTruncatedError,
  ProviderUnavailableError,
} from '@/lib/ai/errors';
import type { LegalRepository } from '@/lib/db/legal-repository';

import type { ModelAnswer } from './answer-schema';
import { generateAnswer } from './answer-generator';
import { SAFE_FALLBACK, verifyAnswerWithReport } from './answer-verifier';
import { buildContext, type ContextBudget } from './context-builder';
import { buildPublicResponse, type PublicResponse } from './public-response';
import { createRequestBudget, type RequestBudget } from './request-budget';
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
  /**
   * Total orchestration budget. It is split between stages: embedding and
   * reranking are capped, generation receives the remainder.
   */
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

/** Stages reported to the client as real progress milestones. */
export type RagProgressStage = Exclude<RagStage, 'orchestration'>;

export interface RagFailureDiagnostics {
  stage: RagStage;
  stageTimings: RagStageTimings;
  /** Non-sensitive failure class, e.g. `output_truncated`. */
  reason?: string;
  metrics?: RagMetrics;
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
  /** Provider stop reason of the generator call (`stop`, `length`, ...), when reported. */
  finishReason?: string | null;
  /** Provider-reported completion tokens of the generator call, when reported. */
  completionTokens?: number | null;
}

export interface RagRunOptions {
  signal?: AbortSignal;
  /** Called when the pipeline enters a stage; used for real progress events. */
  onStage?: (stage: RagProgressStage) => void;
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

interface MutableMetrics {
  llmCallCount: number;
  rejectedClaimCount: number;
  downgradeReasons: string[];
  finishReason?: string | null;
  completionTokens?: number | null;
}

/**
 * Orchestrate one turn:
 *   validate -> resolve standalone -> retrieve -> build context ->
 *   generate -> deterministic verification -> public response.
 * Any stage without acceptable evidence returns a bounded out_of_scope answer.
 */
export async function runRag(
  request: ChatRequest,
  deps: RagServiceDeps,
  options: RagRunOptions = {},
): Promise<RagOutcome> {
  const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const started = Date.now();
  const budget = createRequestBudget(timeoutMs);
  return withRequestDeadline(
    (signal) => runRagWithinBudget(request, deps, signal, budget, options.onStage),
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
  budget: RequestBudget,
  onStage: RagRunOptions['onStage'],
): Promise<RagOutcome> {
  const started = Date.now();
  const stageTimings: Omit<RagStageTimings, 'totalMs'> = {
    retrievalMs: 0,
    contextMs: 0,
    generationMs: 0,
    verificationMs: 0,
  };
  const metrics: MutableMetrics = {
    llmCallCount: 0,
    rejectedClaimCount: 0,
    downgradeReasons: [],
  };
  const enter = (stage: RagProgressStage) => {
    if (!signal.aborted) onStage?.(stage);
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

  enter('retrieval');
  const retrievalStarted = Date.now();
  let evidence;
  try {
    evidence = await retrieveEvidence(
      { query: standalone, corpusVersion: deps.corpusVersion },
      deps.repository,
      deps.embedder,
      deps.reranker,
      { signal, budget },
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

  enter('context');
  const contextStarted = Date.now();
  let context;
  try {
    context = await buildContext(evidence, deps.repository, deps.contextBudget, { signal });
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

  // Generation receives every millisecond that is left, minus a small reserve
  // for verification. If nothing is left, fail now with a classified timeout
  // instead of starting a provider call that cannot finish.
  const generationBudgetMs = budget.generationMs();
  if (generationBudgetMs <= 0) {
    const error = new ProviderUnavailableError('RAG request exceeded its total time budget');
    annotateFailure(error, 'generation', stageTimings, started, {
      reason: 'generation_skipped_budget',
      metrics,
    });
    throw error;
  }

  enter('generation');
  const generationStarted = Date.now();
  metrics.llmCallCount += 1;
  let model: ModelAnswer;
  try {
    model = await generateAnswer(standalone, context, deps.generator, {
      signal,
      timeoutMs: generationBudgetMs,
      onUsage: (usage: LlmUsage) => {
        metrics.finishReason = usage.finishReason;
        metrics.completionTokens = usage.completionTokens;
      },
    });
  } catch (error) {
    stageTimings.generationMs = Date.now() - generationStarted;
    if (error instanceof ModelOutputTruncatedError) {
      // A cut-off answer is a length problem, not missing evidence: surface a
      // retryable error rather than the out-of-scope fallback.
      metrics.downgradeReasons.push('output_truncated');
      annotateFailure(error, 'generation', stageTimings, started, {
        reason: 'output_truncated',
        metrics,
      });
      throw error;
    }
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

  enter('verification');
  const verificationStarted = Date.now();
  let verification;
  try {
    verification = verifyAnswerWithReport(model, context, standalone);
    throwIfAborted(signal);
  } catch (error) {
    stageTimings.verificationMs = Date.now() - verificationStarted;
    annotateFailure(error, 'verification', stageTimings, started);
    throw error;
  }
  stageTimings.verificationMs = Date.now() - verificationStarted;
  metrics.rejectedClaimCount = verification.rejectedClaimCount;
  metrics.downgradeReasons.push(...verification.reasons);
  const canonicalVerified = canonicalizeExplicitReference(verification.answer, standalone, context);
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

function snapshotMetrics(metrics: MutableMetrics): RagMetrics {
  return {
    llmCallCount: metrics.llmCallCount,
    rejectedClaimCount: metrics.rejectedClaimCount,
    downgradeReasons: [...new Set(metrics.downgradeReasons)],
    ...(metrics.finishReason !== undefined ? { finishReason: metrics.finishReason } : {}),
    ...(metrics.completionTokens !== undefined
      ? { completionTokens: metrics.completionTokens }
      : {}),
  };
}

function finishOutcome(
  response: PublicResponse,
  retrievalCount: number,
  stageTimings: Omit<RagStageTimings, 'totalMs'>,
  started: number,
  metrics: MutableMetrics,
): RagOutcome {
  return {
    response,
    retrievalCount,
    stageTimings: { ...stageTimings, totalMs: Date.now() - started },
    metrics: snapshotMetrics(metrics),
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
  detail: { reason?: string; metrics?: MutableMetrics } = {},
): void {
  if (!error || typeof error !== 'object' || getRagFailureDiagnostics(error)) return;
  Object.defineProperty(error, RAG_FAILURE_DIAGNOSTICS, {
    configurable: true,
    enumerable: false,
    value: {
      stage,
      stageTimings: { ...stageTimings, totalMs: Date.now() - started },
      ...(detail.reason ? { reason: detail.reason } : {}),
      ...(detail.metrics ? { metrics: snapshotMetrics(detail.metrics) } : {}),
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

import { ProviderUnavailableError } from '@/lib/ai/errors';

/** Share of the request budget that one optional stage (embedding, reranking) may use. */
export const AUXILIARY_STAGE_SHARE = 0.15;
/** Share of the request budget that must still remain before an optional stage may start. */
export const GENERATION_FLOOR_SHARE = 0.5;
const FINALIZE_RESERVE_SHARE = 0.05;
const FINALIZE_RESERVE_MAX_MS = 1_000;

/**
 * Splits one request deadline between stages. Embedding and reranking are
 * optional helpers: each is capped at 15% of the request and is skipped when
 * starting it would leave generation less than half of the request. Generation
 * receives everything that remains except a small reserve for deterministic
 * verification and serialisation.
 */
export interface RequestBudget {
  readonly totalMs: number;
  remainingMs(): number;
  /** Budget for an optional stage right now; 0 means the stage must be skipped. */
  auxiliaryStageMs(): number;
  /** Budget for generation right now; 0 means generation can no longer start. */
  generationMs(): number;
}

export function createRequestBudget(
  totalMs: number,
  clock: () => number = Date.now,
): RequestBudget {
  const boundedTotal = Math.max(1, totalMs);
  const deadline = clock() + boundedTotal;
  const auxiliaryCap = Math.floor(boundedTotal * AUXILIARY_STAGE_SHARE);
  const generationFloor = Math.floor(boundedTotal * GENERATION_FLOOR_SHARE);
  const finalizeReserve = Math.min(
    FINALIZE_RESERVE_MAX_MS,
    Math.floor(boundedTotal * FINALIZE_RESERVE_SHARE),
  );
  const remaining = () => Math.max(0, deadline - clock());
  return {
    totalMs: boundedTotal,
    remainingMs: remaining,
    auxiliaryStageMs: () => Math.max(0, Math.min(auxiliaryCap, remaining() - generationFloor)),
    generationMs: () => Math.max(0, remaining() - finalizeReserve),
  };
}

/** An optional stage ran out of its own budget; the caller degrades instead of failing. */
export class StageBudgetExceededError extends ProviderUnavailableError {
  constructor(stage: string) {
    super(`${stage} exceeded its stage budget`);
    this.name = 'StageBudgetExceededError';
  }
}

/**
 * Run one stage under its own deadline. The stage signal is aborted when the
 * budget expires or the parent request is cancelled, and the returned promise
 * settles immediately in both cases even if the operation ignores its signal.
 */
export function runWithinStageBudget<T>(
  stage: string,
  budgetMs: number,
  parentSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (parentSignal?.aborted) {
      reject(new ProviderUnavailableError('RAG request cancelled', parentSignal.reason));
      return;
    }

    const controller = new AbortController();
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
      callback();
    };
    const onParentAbort = () => {
      controller.abort(parentSignal?.reason);
      settle(() =>
        reject(new ProviderUnavailableError('RAG request cancelled', parentSignal?.reason)),
      );
    };
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => {
      const error = new StageBudgetExceededError(stage);
      controller.abort(error);
      settle(() => reject(error));
    }, Math.max(1, budgetMs));

    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
  });
}

import { getProviderStatus, getRetryAfterMs, ProviderUnavailableError } from './errors';

export interface TimeoutOptions {
  /** Total budget for this provider stage, including its optional retry. */
  timeoutMs: number;
  /** Retry once on transient 5xx/network/timeout failures. Default true. */
  retry?: boolean;
  /** Parent request signal; aborting it stops the current attempt and backoff. */
  signal?: AbortSignal;
}

export interface RetriableError {
  status?: number;
  retryAfterMs?: number;
}

class AttemptTimeoutError extends Error {
  constructor() {
    super('AI provider attempt exceeded its time budget');
    this.name = 'AttemptTimeoutError';
  }
}

function isTransient(error: unknown): boolean {
  const status = getProviderStatus(error);
  if (status === 429) return false;
  if (typeof status === 'number') return status >= 500;
  if (error instanceof AttemptTimeoutError) return true;
  // ProviderUnavailableError without HTTP metadata and known network errors
  // are retryable once. Permanent 4xx responses and programming errors are not.
  if (error instanceof ProviderUnavailableError) return true;
  if (!(error instanceof Error)) return false;
  return (
    error instanceof TypeError ||
    /api(connection|request)?error|fetcherror|networkerror|econnreset|etimedout|eai_again|enotfound/i.test(
      error.name,
    ) ||
    /network|fetch failed|connection reset|timed out/i.test(error.message)
  );
}

function canRetry(error: unknown): boolean {
  const status = getProviderStatus(error);
  if (status === 429) {
    // A 429 without a positive Retry-After is deliberately not retried. This
    // prevents a quota/rate-limit error from becoming an immediate retry loop.
    const retryAfterMs = getRetryAfterMs(error);
    return retryAfterMs !== undefined && retryAfterMs > 0;
  }
  return isTransient(error);
}

function retryDelayMs(error: unknown): number {
  const retryAfterMs = getRetryAfterMs(error);
  if (getProviderStatus(error) === 429 && retryAfterMs !== undefined) return retryAfterMs;
  // Small bounded jitter avoids synchronized retries while keeping the demo
  // responsive. Math.random is intentionally not used for correctness.
  return 100 + Math.floor(Math.random() * 50);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

async function runAttempt<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  if (parentSignal?.aborted) throw abortReason(parentSignal);

  const controller = new AbortController();
  let timedOut = false;
  let parentAbortListener: (() => void) | undefined;
  let attemptAbortListener: (() => void) | undefined;

  const aborted = new Promise<never>((_, reject) => {
    attemptAbortListener = () => reject(abortReason(controller.signal));
    controller.signal.addEventListener('abort', attemptAbortListener, { once: true });
  });

  if (parentSignal) {
    parentAbortListener = () => controller.abort(abortReason(parentSignal));
    parentSignal.addEventListener('abort', parentAbortListener, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new AttemptTimeoutError());
  }, Math.max(1, timeoutMs));

  try {
    const operationPromise = Promise.resolve().then(() => operation(controller.signal));
    return await Promise.race([operationPromise, aborted]);
  } catch (error) {
    if (timedOut && !parentSignal?.aborted) throw new AttemptTimeoutError();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (parentSignal && parentAbortListener) {
      parentSignal.removeEventListener('abort', parentAbortListener);
    }
    if (attemptAbortListener) {
      controller.signal.removeEventListener('abort', attemptAbortListener);
    }
  }
}

function waitBeforeRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Run one provider stage under one total budget. A parent cancellation wins
 * over retry/deadline handling and is normalised to the public provider error.
 */
export async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: TimeoutOptions,
): Promise<T> {
  const timeoutMs = Math.max(1, options.timeoutMs);
  const deadline = Date.now() + timeoutMs;
  const attempts = options.retry === false ? 1 : 2;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new ProviderUnavailableError('AI provider request cancelled', abortReason(options.signal));
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;

    try {
      return await runAttempt(operation, options.signal, remainingMs);
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) {
        throw new ProviderUnavailableError('AI provider request cancelled', error);
      }
      if (attempt + 1 >= attempts || !canRetry(error)) break;

      const delayMs = retryDelayMs(error);
      if (Date.now() + delayMs >= deadline) break;
      try {
        await waitBeforeRetry(delayMs, options.signal);
      } catch (abortError) {
        throw new ProviderUnavailableError('AI provider request cancelled', abortError);
      }
    }
  }

  const timedOut = Date.now() >= deadline || lastError instanceof AttemptTimeoutError;
  throw new ProviderUnavailableError(
    timedOut ? 'AI provider request timed out' : 'AI provider request failed',
    lastError,
  );
}

/** Convert an HTTP Retry-After header to milliseconds without leaking content. */
export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());
  return undefined;
}

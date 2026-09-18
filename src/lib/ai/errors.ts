/**
 * Raised when a managed model provider is unreachable, times out, or returns a
 * transient (429/5xx) status. Retrieval and generation only ever catch THIS
 * error type; genuine programming errors must surface to tests.
 */
export class ProviderUnavailableError extends Error {
  readonly cause?: unknown;
  constructor(message = 'AI provider is temporarily unavailable', cause?: unknown) {
    super(message);
    this.name = 'ProviderUnavailableError';
    this.cause = cause;
  }
}

/** Raised when a model returns output that never conforms to the schema. */
export class InvalidModelOutputError extends Error {
  constructor(message = 'Model output did not match the required schema') {
    super(message);
    this.name = 'InvalidModelOutputError';
  }
}

/** Read provider metadata without exposing the original error to callers. */
export function getProviderStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; cause?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (candidate.cause && candidate.cause !== error) return getProviderStatus(candidate.cause);
  return undefined;
}

export function getRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    retryAfterMs?: unknown;
    headers?: unknown;
    cause?: unknown;
  };
  if (typeof candidate.retryAfterMs === 'number' && Number.isFinite(candidate.retryAfterMs)) {
    return Math.max(0, candidate.retryAfterMs);
  }
  const headerValue = readRetryAfterHeader(candidate.headers);
  if (headerValue !== undefined) return headerValue;
  if (candidate.cause && candidate.cause !== error) return getRetryAfterMs(candidate.cause);
  return undefined;
}

function readRetryAfterHeader(headers: unknown): number | undefined {
  if (!headers || typeof headers !== 'object') return undefined;

  const headerReader = headers as { get?: unknown };
  if (typeof headerReader.get === 'function') {
    const value = (headerReader.get as (this: unknown, name: string) => unknown).call(
      headers,
      'retry-after',
    );
    if (typeof value === 'string') return parseRetryAfterHeader(value);
  }

  const record = headers as Record<string, unknown>;
  const value = record['retry-after'] ?? record['Retry-After'];
  return typeof value === 'string' ? parseRetryAfterHeader(value) : undefined;
}

function parseRetryAfterHeader(value: string): number | undefined {
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - Date.now());
  return undefined;
}

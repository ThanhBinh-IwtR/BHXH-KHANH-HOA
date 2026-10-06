import { NextResponse } from 'next/server';

export type ApiErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'rate_limited'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'output_truncated'
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  provider_rate_limited: 429,
  provider_timeout: 504,
  provider_unavailable: 503,
  output_truncated: 502,
  internal_error: 500,
};

export function apiErrorStatus(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * Build a safe JSON error. Only a stable code and a generic message ever reach
 * the client — never provider internals, stack traces, or secrets.
 */
export function apiError(code: ApiErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: STATUS_BY_CODE[code] });
}

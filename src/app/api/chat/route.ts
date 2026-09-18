import { NextResponse, type NextRequest } from 'next/server';

import {
  getProviderStatus,
  InvalidModelOutputError,
  ProviderUnavailableError,
} from '@/lib/ai/errors';
import { getRateLimitConfig } from '@/lib/config/env';
import { RepositoryUnavailableError } from '@/lib/db/legal-repository';
import { apiError } from '@/lib/http/errors';
import { RateLimiter, clientIpFrom } from '@/lib/http/rate-limit';
import { chatRequestSchema, getRagFailureDiagnostics, runRag } from '@/features/legal-rag/service';
import { createRagDeps } from '@/features/legal-rag/service-factory';

export const runtime = 'nodejs';

let limiter: RateLimiter | null = null;
function getLimiter(): RateLimiter {
  if (!limiter) {
    const config = getRateLimitConfig();
    limiter = new RateLimiter({
      limit: config.max,
      windowMs: config.windowMs,
      salt: config.salt,
    });
  }
  return limiter;
}

export function resetChatRateLimiter(): void {
  limiter = null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  const ip = clientIpFrom(request.headers);
  if (!getLimiter().check(ip).allowed) {
    return apiError('rate_limited', 'Bạn đã gửi quá nhiều yêu cầu, vui lòng thử lại sau.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('invalid_request', 'Nội dung yêu cầu không phải JSON hợp lệ.');
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError('invalid_request', 'Yêu cầu không hợp lệ.');
  }

  try {
    const { response, retrievalCount, stageTimings, metrics } = await runRag(
      parsed.data,
      createRagDeps(),
      { signal: request.signal },
    );
    // Privacy-preserving log: no question, answer, or source text.
    console.info(
      JSON.stringify({
        route: 'chat',
        status: 200,
        latencyMs: Date.now() - started,
        retrievalCount,
        scopeStatus: response.scopeStatus,
        stageTimings,
        metrics,
      }),
    );
    const output = NextResponse.json(response);
    output.headers.set(
      'Server-Timing',
      [
        `retrieval;dur=${stageTimings.retrievalMs}`,
        `context;dur=${stageTimings.contextMs}`,
        `generation;dur=${stageTimings.generationMs}`,
        `verification;dur=${stageTimings.verificationMs}`,
      ].join(', '),
    );
    output.headers.set('X-Rag-LLM-Call-Count', String(metrics.llmCallCount));
    output.headers.set('X-Rag-Rejected-Claims', String(metrics.rejectedClaimCount));
    return output;
  } catch (error) {
    if (
      error instanceof ProviderUnavailableError ||
      error instanceof InvalidModelOutputError ||
      error instanceof RepositoryUnavailableError
    ) {
      const providerStatus = getProviderStatus(error);
      console.warn(
        '[api/chat] provider unavailable:',
        JSON.stringify({
          name: error.name,
          providerStatus,
          ...(getRagFailureDiagnostics(error) ?? {}),
        }),
      );
      if (providerStatus === 429) {
        return apiError(
          'provider_rate_limited',
          'Dịch vụ AI đang bận do giới hạn lưu lượng. Vui lòng thử lại sau ít phút.',
        );
      }
      if (error instanceof ProviderUnavailableError && /timed out|time budget/i.test(error.message)) {
        return apiError(
          'provider_timeout',
          'Dịch vụ AI chưa phản hồi trong thời gian cho phép. Vui lòng thử lại sau.',
        );
      }
      return apiError('provider_unavailable', 'Dịch vụ tạm thời không khả dụng, vui lòng thử lại.');
    }
    // Server-side only: surface the real cause (e.g. invalid env) in the terminal
    // for debugging. The client still receives a generic message.
    console.error('[api/chat] unhandled error:', error instanceof Error ? error.stack : error);
    return apiError('internal_error', 'Đã xảy ra lỗi nội bộ.');
  }
}

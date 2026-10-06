import { NextResponse, type NextRequest } from 'next/server';

import {
  getProviderStatus,
  InvalidModelOutputError,
  ModelOutputTruncatedError,
  ProviderUnavailableError,
} from '@/lib/ai/errors';
import { getRateLimitConfig } from '@/lib/config/env';
import { RepositoryUnavailableError } from '@/lib/db/legal-repository';
import { apiError, apiErrorStatus, type ApiErrorCode } from '@/lib/http/errors';
import { RateLimiter, clientIpFrom } from '@/lib/http/rate-limit';
import {
  chatRequestSchema,
  getRagFailureDiagnostics,
  runRag,
  type ChatRequest,
  type RagOutcome,
} from '@/features/legal-rag/service';
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

export async function POST(request: NextRequest): Promise<Response> {
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

  if (request.headers.get('accept')?.includes('text/event-stream')) {
    return streamChat(parsed.data, request, started);
  }

  try {
    const outcome = await runRag(parsed.data, createRagDeps(), { signal: request.signal });
    logSuccess(outcome, started);
    const { response, stageTimings, metrics } = outcome;
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
    const failure = describeFailure(error);
    return apiError(failure.code, failure.message);
  }
}

/**
 * Real progress over Server-Sent Events: one `stage` event per pipeline
 * milestone, then exactly one `result` (the same JSON body as the non-streamed
 * response) or one `error` ({ code, message, status }). Cancelling the fetch
 * aborts `request.signal`, which stops the pipeline and its provider calls.
 */
function streamChat(chat: ChatRequest, request: NextRequest, started: number): Response {
  const encoder = new TextEncoder();
  const streamClosed = new AbortController();
  const signal = AbortSignal.any([request.signal, streamClosed.signal]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: 'stage' | 'result' | 'error', data: unknown) => {
        if (signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client disconnected between the check and the write.
        }
      };
      try {
        const outcome = await runRag(chat, createRagDeps(), {
          signal,
          onStage: (stage) => send('stage', { stage }),
        });
        logSuccess(outcome, started);
        send('result', outcome.response);
      } catch (error) {
        const failure = describeFailure(error);
        send('error', { ...failure, status: apiErrorStatus(failure.code) });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by a cancelled client.
        }
      }
    },
    cancel() {
      streamClosed.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

/** Privacy-preserving log: no question, answer, or source text. */
function logSuccess({ response, retrievalCount, stageTimings, metrics }: RagOutcome, started: number) {
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
}

/** Map a pipeline failure to a stable public code/message and log redacted diagnostics. */
function describeFailure(error: unknown): { code: ApiErrorCode; message: string } {
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
    if (error instanceof ModelOutputTruncatedError) {
      return {
        code: 'output_truncated',
        message:
          'Câu trả lời vượt quá độ dài cho phép nên bị cắt giữa chừng; hệ thống không hiển thị nội dung chưa hoàn chỉnh. Vui lòng thử lại hoặc hỏi cụ thể hơn, ví dụ nêu rõ Điều/Khoản.',
      };
    }
    if (providerStatus === 429) {
      return {
        code: 'provider_rate_limited',
        message: 'Dịch vụ AI đang bận do giới hạn lưu lượng. Vui lòng thử lại sau ít phút.',
      };
    }
    if (error instanceof ProviderUnavailableError && /timed out|time budget/i.test(error.message)) {
      return {
        code: 'provider_timeout',
        message: 'Dịch vụ AI chưa phản hồi trong thời gian cho phép. Vui lòng thử lại sau.',
      };
    }
    return {
      code: 'provider_unavailable',
      message: 'Dịch vụ tạm thời không khả dụng, vui lòng thử lại.',
    };
  }
  // Server-side only: surface the real cause (e.g. invalid env) in the terminal
  // for debugging. The client still receives a generic message.
  console.error('[api/chat] unhandled error:', error instanceof Error ? error.stack : error);
  return { code: 'internal_error', message: 'Đã xảy ra lỗi nội bộ.' };
}

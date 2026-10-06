import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RagServiceDeps } from '@/features/legal-rag/service';
import { ModelOutputTruncatedError, ProviderUnavailableError } from '@/lib/ai/errors';
import type { LlmClient } from '@/lib/ai/contracts';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { FakeEmbedder, FakeLlm, IdentityReranker, UnavailableLlm } from '../legal-rag/fakes';

const state = vi.hoisted(() => ({ deps: null as unknown as RagServiceDeps }));
vi.mock('@/features/legal-rag/service-factory', () => ({ createRagDeps: () => state.deps }));

import { POST, resetChatRateLimiter } from '@/app/api/chat/route';

const GROUNDED_ID = 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1';

function baseDeps(overrides: Partial<RagServiceDeps> = {}): RagServiceDeps {
  return {
    repository: new MemoryLegalRepository(sampleCorpus),
    embedder: new FakeEmbedder([3, 1, 0, 2, 0, 0, 1, 0]),
    reranker: new IdentityReranker(),
    generator: new FakeLlm([
      {
        scope_status: 'grounded',
        short_answer: 'Người sử dụng lao động đóng 17%.',
        analysis: [{ claim: 'Tỷ lệ đóng là 17%.', source_ids: [GROUNDED_ID] }],
        missing_information: [],
        follow_up_question: null,
      },
    ]),
    corpusVersion: sampleCorpusVersion,
    ...overrides,
  };
}

class RateLimitedLlm implements LlmClient {
  async generateStructured<T>(): Promise<T> {
    throw new ProviderUnavailableError(
      'provider rate limited',
      Object.assign(new Error('upstream rate limit'), { status: 429 }),
    );
  }
}

class TruncatingLlm implements LlmClient {
  async generateStructured<T>(): Promise<T> {
    throw new ModelOutputTruncatedError();
  }
}

class TimedOutLlm implements LlmClient {
  async generateStructured<T>(): Promise<T> {
    throw new ProviderUnavailableError('AI provider request timed out');
  }
}

function post(body: unknown, ip = '10.0.0.1') {
  return POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  );
}

function parseEvents(text: string): { event: string; data: Record<string, unknown> }[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? '';
      const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length) ?? '{}';
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_SALT = 'route-test-salt';
    process.env.RATE_LIMIT_MAX = '20';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    resetChatRateLimiter();
    state.deps = baseDeps();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RATE_LIMIT_SALT;
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    resetChatRateLimiter();
  });

  it('returns a grounded, verified answer with citations', async () => {
    const response = await post(
      { message: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?' },
      '10.0.0.2',
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.scopeStatus).toBe('grounded');
    expect(json.analysis[0].citations[0].sourceId).toBe(GROUNDED_ID);
    expect(json.sources[0].sourceId).toBe(GROUNDED_ID);
    expect(JSON.stringify(json)).not.toContain('fusedScore');
    expect(response.headers.get('server-timing')).toMatch(/generation;dur=\d+/);
    expect(response.headers.get('x-rag-llm-call-count')).toBe('1');
  });

  it('logs only non-sensitive stage timing fields for a successful request', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const response = await post(
      { message: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?' },
      '10.0.0.20',
    );

    expect(response.status).toBe(200);
    const entry = JSON.parse(String(info.mock.calls.at(-1)?.[0]));
    expect(entry.stageTimings).toEqual(
      expect.objectContaining({
        retrievalMs: expect.any(Number),
        contextMs: expect.any(Number),
        generationMs: expect.any(Number),
        verificationMs: expect.any(Number),
        totalMs: expect.any(Number),
      }),
    );
    expect(entry).not.toHaveProperty('question');
    expect(entry).not.toHaveProperty('answer');
    expect(entry).not.toHaveProperty('sourceText');
  });

  it('rejects an invalid body with 400', async () => {
    const response = await post({ message: '' }, '10.0.0.3');
    expect(response.status).toBe(400);
  });

  it('rejects oversized history with 400', async () => {
    const history = Array.from({ length: 40 }, () => ({ role: 'user', content: 'x' }));
    const response = await post({ message: 'Câu hỏi', history }, '10.0.0.4');
    expect(response.status).toBe(400);
  });

  it('returns out_of_scope (200) when there is no evidence', async () => {
    state.deps = baseDeps({
      repository: new MemoryLegalRepository({ documents: sampleCorpus.documents, chunks: [] }),
    });
    const response = await post({ message: 'Thủ tục đăng ký kết hôn ở đâu?' }, '10.0.0.5');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.scopeStatus).toBe('out_of_scope');
    expect(json.sources).toEqual([]);
  });

  it('returns 503 without leaking internals when the model is unavailable', async () => {
    state.deps = baseDeps({ generator: new UnavailableLlm() });
    const response = await post(
      { message: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?' },
      '10.0.0.6',
    );
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(JSON.stringify(json)).not.toMatch(/llm down|stack|apiKey/i);
  });

  it('returns an accurate timeout message and logs redacted generation timing', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.deps = baseDeps({ generator: new TimedOutLlm() });

    const response = await post(
      { message: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?' },
      '10.0.0.61',
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'provider_timeout',
        message: expect.stringMatching(/dịch vụ AI|provider/i),
      },
    });

    const call = warning.mock.calls.find(([label]) => label === '[api/chat] provider unavailable:');
    expect(call).toBeDefined();
    const details = JSON.parse(String(call?.[1]));
    expect(details.stage).toBe('generation');
    expect(details.stageTimings).toEqual(
      expect.objectContaining({
        generationMs: expect.any(Number),
        totalMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(details)).not.toMatch(/khoản 3|apiKey|sourceText|shortAnswer/i);
  });

  it('reports a truncated model answer as too long, never as out of scope', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.deps = baseDeps({ generator: new TruncatingLlm() });

    const response = await post(
      { message: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?' },
      '10.0.0.62',
    );

    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json).toMatchObject({
      error: { code: 'output_truncated', message: expect.stringMatching(/quá độ dài|bị cắt/i) },
    });
    expect(JSON.stringify(json)).not.toMatch(/ngoài phạm vi|out_of_scope/i);
    const call = warning.mock.calls.find(([label]) => label === '[api/chat] provider unavailable:');
    const details = JSON.parse(String(call?.[1]));
    expect(details).toMatchObject({ name: 'ModelOutputTruncatedError', reason: 'output_truncated' });
  });

  it('returns a retryable provider-rate-limit response for an upstream 429', async () => {
    state.deps = baseDeps({ generator: new RateLimitedLlm() });
    const response = await post(
      { message: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?' },
      '10.0.0.7',
    );
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'provider_rate_limited',
        message: expect.stringMatching(/thử lại/i),
      },
    });
  });

  it('streams real stage milestones and then the verified answer over SSE', async () => {
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream, application/json',
          'x-forwarded-for': '10.0.0.70',
        },
        body: JSON.stringify({ message: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?' }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);
    const events = parseEvents(await response.text());
    expect(events.filter((event) => event.event === 'stage').map((event) => event.data.stage)).toEqual([
      'retrieval',
      'context',
      'generation',
      'verification',
    ]);
    const result = events.at(-1);
    expect(result?.event).toBe('result');
    expect(result?.data).toMatchObject({ scopeStatus: 'grounded' });
    expect(JSON.stringify(events)).not.toContain('fusedScore');
  });

  it('ends the stream with a classified error event when the provider fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.deps = baseDeps({ generator: new UnavailableLlm() });
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          'x-forwarded-for': '10.0.0.71',
        },
        body: JSON.stringify({ message: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?' }),
      }) as never,
    );

    const events = parseEvents(await response.text());
    expect(events.at(-1)).toEqual({
      event: 'error',
      data: {
        code: 'provider_unavailable',
        message: expect.stringMatching(/thử lại/i),
        status: 503,
      },
    });
    expect(JSON.stringify(events)).not.toMatch(/llm down|stack|apiKey/i);
  });

  it('returns 429 after exceeding the rate limit for one client', async () => {
    process.env.RATE_LIMIT_MAX = '1';
    resetChatRateLimiter();
    await post({ message: 'Câu hỏi hợp lệ về bảo hiểm' }, '10.9.9.9');
    const last = await post({ message: 'Câu hỏi hợp lệ về bảo hiểm' }, '10.9.9.9');
    expect(last.status).toBe(429);
  });
});

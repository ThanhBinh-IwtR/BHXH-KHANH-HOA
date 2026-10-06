// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { stageTimeoutMs } from '@/lib/ai/contracts';
import {
  getRetryAfterMs,
  InvalidModelOutputError,
  ModelOutputTruncatedError,
  ProviderUnavailableError,
} from '@/lib/ai/errors';
import { HuggingFaceEmbeddingClient } from '@/lib/ai/huggingface-embedding';
import { HuggingFaceRerankerClient } from '@/lib/ai/huggingface-reranker';
import { OpenAiCompatibleLlm } from '@/lib/ai/openai-compatible-llm';
import { withTimeout } from '@/lib/ai/with-timeout';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('withTimeout', () => {
  it('retries once on a transient failure then succeeds', async () => {
    const operation = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }))
      .mockResolvedValueOnce('ok');
    const result = await withTimeout(operation, { timeoutMs: 1000 });
    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-transient 4xx error', async () => {
    const operation = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValue(Object.assign(new Error('bad'), { status: 400 }));
    await expect(withTimeout(operation, { timeoutMs: 1000 })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not retry a rate-limited request immediately', async () => {
    const operation = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    await expect(withTimeout(operation, { timeoutMs: 1000 })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('waits for Retry-After before the one permitted rate-limit retry', async () => {
    const started = Date.now();
    const operation = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), {
        status: 429,
        retryAfterMs: 25,
      }))
      .mockResolvedValueOnce('ok');

    await expect(withTimeout(operation, { timeoutMs: 1000 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });

  it('reads Retry-After from provider error headers', () => {
    const error = Object.assign(new Error('rate limited'), {
      status: 429,
      headers: new Headers({ 'retry-after': '0.02' }),
    });
    expect(getRetryAfterMs(error)).toBe(20);
  });

  it('does not retry an unknown programming error', async () => {
    const operation = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValue(new Error('unexpected bug'));
    await expect(withTimeout(operation, { timeoutMs: 1000 })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('normalises a persistent failure to ProviderUnavailableError', async () => {
    const operation = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValue(Object.assign(new Error('down'), { status: 500 }));
    await expect(withTimeout(operation, { timeoutMs: 1000 })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe('stage budgets', () => {
  it('uses the smaller of the adapter timeout and the call budget', () => {
    expect(stageTimeoutMs(36_000)).toBe(36_000);
    expect(stageTimeoutMs(36_000, { timeoutMs: 9_000 })).toBe(9_000);
    expect(stageTimeoutMs(5_000, { timeoutMs: 9_000 })).toBe(5_000);
    expect(stageTimeoutMs(5_000, { timeoutMs: 0 })).toBe(1);
  });

  it('caps a hung first attempt so the permitted retry still fits the stage budget', async () => {
    let attempts = 0;
    const started = Date.now();
    const result = await withTimeout(
      (signal) => {
        attempts += 1;
        if (attempts === 1) {
          return new Promise<string>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        }
        return Promise.resolve('second attempt');
      },
      { timeoutMs: 1_000, attemptTimeoutMs: 100 },
    );

    expect(result).toBe('second attempt');
    expect(attempts).toBe(2);
    expect(Date.now() - started).toBeLessThan(600);
  });

  it('lets the only attempt use the whole budget when no attempt cap is set', async () => {
    const started = Date.now();
    await expect(
      withTimeout(
        (signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          ),
        { timeoutMs: 150, retry: false },
      ),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('stops an embedding call at the per-call stage budget, not the adapter timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }),
        ),
    );
    const client = new HuggingFaceEmbeddingClient({
      baseUrl: 'https://router.huggingface.co',
      apiKey: 'test',
      model: 'BAAI/bge-m3',
      timeoutMs: 30_000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const started = Date.now();

    await expect(client.embed(['câu hỏi'], { timeoutMs: 600 })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(550);
    expect(elapsed).toBeLessThan(1_200);
    // A hung first attempt is cut at half the stage budget, leaving room for one retry.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('HuggingFaceEmbeddingClient', () => {
  it('calls the Hugging Face task endpoint and returns one vector per input', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([[0.1, 0.2]]),
    );
    const client = new HuggingFaceEmbeddingClient({
      baseUrl: 'https://router.example',
      apiKey: 'k',
      model: 'BAAI/bge-m3',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const vectors = await client.embed(['xin chào']);
    expect(vectors).toEqual([[0.1, 0.2]]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://router.example/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction',
      expect.objectContaining({
        body: JSON.stringify({ inputs: ['xin chào'] }),
      }),
    );
  });

  it('maps an HTTP error to ProviderUnavailableError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    const client = new HuggingFaceEmbeddingClient({
      baseUrl: 'https://router.example',
      apiKey: 'k',
      model: 'BAAI/bge-m3',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.embed(['x'])).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('opens a session circuit after an embedding permission error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    const client = new HuggingFaceEmbeddingClient({
      baseUrl: 'https://router.example',
      apiKey: 'k',
      model: 'BAAI/bge-m3',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.embed(['x'])).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(client.embed(['x'])).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('HuggingFaceRerankerClient', () => {
  it('calls the Hugging Face task endpoint and returns a score per passage', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([
        { label: 'LABEL_0', score: 0.9 },
        { label: 'LABEL_0', score: 0.1 },
      ]),
    );
    const client = new HuggingFaceRerankerClient({
      baseUrl: 'https://router.example',
      apiKey: 'k',
      model: 'BAAI/bge-reranker-v2-m3',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const scores = await client.rerank('q', ['a', 'b']);
    expect(scores).toEqual([0.9, 0.1]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://router.example/hf-inference/models/BAAI/bge-reranker-v2-m3',
      expect.objectContaining({
        body: JSON.stringify({
          inputs: [
            { text: 'q', text_pair: 'a' },
            { text: 'q', text_pair: 'b' },
          ],
        }),
      }),
    );
  });

  it('accepts the singleton object returned for one text pair', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ label: 'LABEL_0', score: 0.75 }));
    const client = new HuggingFaceRerankerClient({
      baseUrl: 'https://router.example',
      apiKey: 'k',
      model: 'BAAI/bge-reranker-v2-m3',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.rerank('q', ['a'])).resolves.toEqual([0.75]);
  });

  it('opens a session circuit after a reranker permission error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const client = new HuggingFaceRerankerClient({
      baseUrl: 'https://router.example',
      apiKey: 'k',
      model: 'BAAI/bge-reranker-v2-m3',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.rerank('q', ['a'])).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(client.rerank('q', ['a'])).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAiCompatibleLlm', () => {
  it('sends configured reasoning controls in the provider request', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'glm-4.7-flash',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '{"ok":true}', refusal: null },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });

    const client = new OpenAiCompatibleLlm({
      baseUrl: 'https://api.z.ai/api/paas/v4',
      apiKey: 'test-key',
      model: 'glm-4.7-flash',
      timeoutMs: 1000,
      thinkingMode: 'disabled',
      maxOutputTokens: 512,
    } as ConstructorParameters<typeof OpenAiCompatibleLlm>[0] & {
      thinkingMode: 'disabled';
      maxOutputTokens: number;
    });

    await expect(
      client.generateStructured<{ ok: boolean }>({
        system: 'Return JSON.',
        user: 'Test',
        schemaName: 'test_payload',
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(requestBody).toMatchObject({
      model: 'glm-4.7-flash',
      max_tokens: 512,
      thinking: { type: 'disabled' },
    });
  });
});

describe('OpenAiCompatibleLlm finish_reason handling', () => {
  function completion(content: string, finishReason: string, completionTokens = 10) {
    return jsonResponse({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 0,
      model: 'glm-4.5-flash',
      choices: [
        { index: 0, finish_reason: finishReason, message: { role: 'assistant', content, refusal: null } },
      ],
      usage: { prompt_tokens: 1, completion_tokens: completionTokens, total_tokens: completionTokens + 1 },
    });
  }

  function client() {
    return new OpenAiCompatibleLlm({
      baseUrl: 'https://api.z.ai/api/paas/v4',
      apiKey: 'test-key',
      model: 'glm-4.5-flash',
      timeoutMs: 1000,
      maxOutputTokens: 2048,
    });
  }

  it('reports a cut-off JSON payload as truncation, not as a schema error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      completion('{"scope_status":"grounded","short_answer":"Mức đóng', 'length', 2048),
    );
    const onUsage = vi.fn();

    const failure = client().generateStructured(
      { system: 'Return JSON.', user: 'Test', schemaName: 'legal_answer' },
      { onUsage },
    );

    await expect(failure).rejects.toBeInstanceOf(ModelOutputTruncatedError);
    await expect(failure).rejects.toBeInstanceOf(InvalidModelOutputError);
    expect(onUsage).toHaveBeenCalledWith({ finishReason: 'length', completionTokens: 2048 });
    vi.restoreAllMocks();
  });

  it('accepts a complete JSON object even when the provider reports the length limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion('{"ok":true}', 'length'));

    await expect(
      client().generateStructured({ system: 'Return JSON.', user: 'Test', schemaName: 'test' }),
    ).resolves.toEqual({ ok: true });
    vi.restoreAllMocks();
  });

  it('keeps a genuinely malformed but complete answer classified as a schema error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(completion('không phải JSON', 'stop'));

    const failure = client().generateStructured({
      system: 'Return JSON.',
      user: 'Test',
      schemaName: 'test',
    });
    await expect(failure).rejects.toBeInstanceOf(InvalidModelOutputError);
    await expect(failure).rejects.not.toBeInstanceOf(ModelOutputTruncatedError);
    vi.restoreAllMocks();
  });
});

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { getRetryAfterMs, ProviderUnavailableError } from '@/lib/ai/errors';
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
      'https://router.example/hf-inference/models/BAAI/bge-m3',
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
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([0.9, 0.1]));
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
          inputs: { source_sentence: 'q', sentences: ['a', 'b'] },
        }),
      }),
    );
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

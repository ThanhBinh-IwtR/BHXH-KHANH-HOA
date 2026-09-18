import { describe, expect, it } from 'vitest';

import { ProviderUnavailableError } from '@/lib/ai/errors';
import type { EmbeddingClient, LlmClient, RerankerClient } from '@/lib/ai/contracts';
import { runRag, type RagServiceDeps } from '@/features/legal-rag/service';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { FakeEmbedder, IdentityReranker } from './fakes';

class DelayedEmbedder implements EmbeddingClient {
  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return texts.map(() => [1, 0, 0, 0, 0, 0, 0, 0]);
  }
}

class UnusedLlm implements LlmClient {
  async generateStructured<T>(): Promise<T> {
    throw new Error('should not be called after the request deadline');
  }
}

class UnusedReranker implements RerankerClient {
  async rerank(): Promise<readonly number[]> {
    throw new Error('should not be called after the request deadline');
  }
}

class AbortAwareLlm implements LlmClient {
  async generateStructured<T>(
    _input: { system: string; user: string; schemaName: string },
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => resolve({
          scope_status: 'grounded',
          short_answer: 'Mức đóng là 17%.',
          analysis: [{ claim: 'Mức đóng là 17%.', source_ids: ['nd-158-2025:dieu-12:khoan-3:2025-demo-v1'] }],
          ai_supplement: null,
          missing_information: [],
          follow_up_question: null,
        } as T),
        100,
      );
      const signal = options?.signal;
      if (!signal) return;
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  }
}

function deps(): RagServiceDeps {
  return {
    repository: new MemoryLegalRepository(sampleCorpus),
    embedder: new DelayedEmbedder(),
    reranker: new UnusedReranker(),
    generator: new UnusedLlm(),
    corpusVersion: sampleCorpusVersion,
    requestTimeoutMs: 20,
  };
}

describe('runRag request budget', () => {
  it('fails with a provider-unavailable error before the total request deadline', async () => {
    const started = Date.now();

    await expect(
      runRag({ message: 'mức đóng bảo hiểm xã hội tự nguyện', history: [] }, deps()),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(Date.now() - started).toBeLessThan(80);
  });

  it('propagates a caller abort into the active generation request', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const promise = runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      {
        repository: new MemoryLegalRepository(sampleCorpus),
        embedder: new FakeEmbedder(),
        reranker: new IdentityReranker(),
        generator: new AbortAwareLlm(),
        corpusVersion: sampleCorpusVersion,
        requestTimeoutMs: 5_000,
      },
      { signal: controller.signal } as never,
    );

    setTimeout(() => controller.abort(), 5);
    await expect(promise).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(Date.now() - started).toBeLessThan(80);
  });
});

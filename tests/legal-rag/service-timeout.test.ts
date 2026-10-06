import { describe, expect, it } from 'vitest';

import { ProviderUnavailableError } from '@/lib/ai/errors';
import type {
  EmbeddingClient,
  LlmCallOptions,
  LlmClient,
  ProviderCallOptions,
  RerankerClient,
} from '@/lib/ai/contracts';
import { getRagFailureDiagnostics, runRag, type RagServiceDeps } from '@/features/legal-rag/service';
import type { RetrievedChunk, SearchQuery } from '@/features/legal-rag/types';
import type { RepositoryCallOptions } from '@/lib/db/legal-repository';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { FakeEmbedder, IdentityReranker } from './fakes';

const SOURCE_ID = 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1';
const NATURAL_QUESTION = 'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Provider stage that is slow and records whether it was told to stop. */
class SlowEmbedder implements EmbeddingClient {
  aborted = false;
  lastTimeoutMs: number | undefined;
  constructor(private readonly delayMs: number) {}
  async embed(texts: readonly string[], options?: ProviderCallOptions): Promise<readonly number[][]> {
    this.lastTimeoutMs = options?.timeoutMs;
    options?.signal?.addEventListener('abort', () => (this.aborted = true), { once: true });
    await sleep(this.delayMs);
    return texts.map(() => [1, 0, 0, 0, 0, 0, 0, 0]);
  }
}

class SlowReranker implements RerankerClient {
  calls = 0;
  aborted = false;
  constructor(private readonly delayMs: number) {}
  async rerank(
    _query: string,
    passages: readonly string[],
    options?: ProviderCallOptions,
  ): Promise<readonly number[]> {
    this.calls += 1;
    options?.signal?.addEventListener('abort', () => (this.aborted = true), { once: true });
    await sleep(this.delayMs);
    return passages.map((_passage, index) => passages.length - index);
  }
}

/** Answers with the first source it was given, so it works for any retrieval path. */
class EchoSourceLlm implements LlmClient {
  calls = 0;
  lastOptions: LlmCallOptions | undefined;
  async generateStructured<T>(
    input: { system: string; user: string; schemaName: string },
    options?: LlmCallOptions,
  ): Promise<T> {
    this.calls += 1;
    this.lastOptions = options;
    const sourceId = /ID: (\S+)/.exec(input.user)?.[1] ?? 'missing';
    return {
      scope_status: 'grounded',
      short_answer: 'Nguồn được trích dẫn quy định về mức đóng.',
      analysis: [{ claim: 'Nguồn được trích dẫn quy định về mức đóng.', source_ids: [sourceId] }],
      missing_information: [],
      follow_up_question: null,
    } as T;
  }
}

class HangingLlm implements LlmClient {
  aborted = false;
  async generateStructured<T>(
    _input: { system: string; user: string; schemaName: string },
    options?: LlmCallOptions,
  ): Promise<T> {
    return new Promise<T>((_resolve, reject) => {
      options?.signal?.addEventListener(
        'abort',
        () => {
          this.aborted = true;
          reject(options.signal?.reason);
        },
        { once: true },
      );
    });
  }
}

class AbortAwareLlm implements LlmClient {
  async generateStructured<T>(
    _input: { system: string; user: string; schemaName: string },
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    await sleep(100, options?.signal);
    return {
      scope_status: 'grounded',
      short_answer: 'Mức đóng là 17%.',
      analysis: [{ claim: 'Mức đóng là 17%.', source_ids: [SOURCE_ID] }],
      missing_information: [],
      follow_up_question: null,
    } as T;
  }
}

/** Memory repository whose hybrid search is slow and observes cancellation. */
class SlowSearchRepository extends MemoryLegalRepository {
  hybridAborted = false;
  constructor(private readonly delayMs: number) {
    super(sampleCorpus);
  }
  override async hybridSearch(
    input: SearchQuery,
    options?: RepositoryCallOptions,
  ): Promise<readonly RetrievedChunk[]> {
    options?.signal?.addEventListener('abort', () => (this.hybridAborted = true), { once: true });
    await sleep(this.delayMs, options?.signal);
    return super.hybridSearch(input, options);
  }
}

function baseDeps(overrides: Partial<RagServiceDeps>): RagServiceDeps {
  return {
    repository: new MemoryLegalRepository(sampleCorpus),
    embedder: new FakeEmbedder(),
    reranker: new IdentityReranker(),
    generator: new EchoSourceLlm(),
    corpusVersion: sampleCorpusVersion,
    requestTimeoutMs: 5_000,
    ...overrides,
  };
}

describe('runRag request budget', () => {
  it('still generates an answer when embedding and reranking are slow (P0-19 repro)', async () => {
    // Same proportions as the audit repro: embed 300 ms + rerank 300 ms with a
    // 500 ms request. Before stage budgets this failed blank after ~513 ms.
    const embedder = new SlowEmbedder(300);
    const reranker = new SlowReranker(300);
    const generator = new EchoSourceLlm();
    const started = Date.now();

    const result = await runRag(
      { message: NATURAL_QUESTION, history: [] },
      baseDeps({ embedder, reranker, generator, requestTimeoutMs: 500 }),
    );

    expect(generator.calls).toBe(1);
    expect(result.response.scopeStatus).not.toBe('out_of_scope');
    expect(result.metrics.downgradeReasons).toEqual(
      expect.arrayContaining([
        'embedding_timeout_keyword_fallback',
        'reranker_timeout_order_preserved',
      ]),
    );
    expect(embedder.aborted).toBe(true);
    expect(reranker.aborted).toBe(true);
    expect(embedder.lastTimeoutMs).toBeLessThanOrEqual(75);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('skips reranking when it would leave generation less than its floor', async () => {
    const reranker = new SlowReranker(0);
    const generator = new EchoSourceLlm();

    const result = await runRag(
      { message: NATURAL_QUESTION, history: [] },
      baseDeps({
        repository: new SlowSearchRepository(300),
        reranker,
        generator,
        requestTimeoutMs: 500,
      }),
    );

    expect(reranker.calls).toBe(0);
    expect(generator.calls).toBe(1);
    expect(result.metrics.downgradeReasons).toContain('reranker_skipped_budget');
  });

  it('gives generation the remaining request budget as its stage timeout', async () => {
    const generator = new EchoSourceLlm();

    await runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      baseDeps({ generator, requestTimeoutMs: 10_000 }),
    );

    // 10 s budget minus a 500 ms verification reserve, minus elapsed time.
    expect(generator.lastOptions?.timeoutMs).toBeGreaterThan(9_000);
    expect(generator.lastOptions?.timeoutMs).toBeLessThanOrEqual(9_500);
  });

  it('aborts a hanging generation at the request deadline with a classified error', async () => {
    const generator = new HangingLlm();
    const started = Date.now();

    const failure = runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      baseDeps({ generator, requestTimeoutMs: 300 }),
    );

    await expect(failure).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(failure).rejects.toThrow(/total time budget/);
    expect(generator.aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(450);
  });

  it('cancels an in-flight repository call when the request deadline expires (P0-20)', async () => {
    const repository = new SlowSearchRepository(5_000);
    const started = Date.now();

    const failure = runRag(
      { message: NATURAL_QUESTION, history: [] },
      baseDeps({ repository, requestTimeoutMs: 300 }),
    );

    await expect(failure).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(repository.hybridAborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(450);
  });

  it('propagates a caller abort into the active generation request', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const promise = runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      baseDeps({ generator: new AbortAwareLlm() }),
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort(), 5);
    await expect(promise).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(Date.now() - started).toBeLessThan(80);
  });

  it('annotates a request-deadline failure with the stage timings', async () => {
    const failure = runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      baseDeps({ generator: new HangingLlm(), requestTimeoutMs: 200 }),
    ).catch((error: unknown) => error);

    const diagnostics = getRagFailureDiagnostics(await failure);
    expect(diagnostics?.stageTimings.totalMs).toEqual(expect.any(Number));
  });
});

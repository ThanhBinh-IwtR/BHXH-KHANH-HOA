import type { EmbeddingClient, LlmClient, RerankerClient } from '@/lib/ai/contracts';
import { ProviderUnavailableError } from '@/lib/ai/errors';

/** Returns queued JSON payloads in order; records exact call count. */
export class FakeLlm implements LlmClient {
  calls = 0;
  constructor(private readonly responses: unknown[]) {}
  async generateStructured<T>(): Promise<T> {
    const response = this.responses[this.calls];
    this.calls += 1;
    if (response === undefined) {
      throw new Error(`FakeLlm received unexpected call #${this.calls}`);
    }
    return response as T;
  }
}

export class UnavailableLlm implements LlmClient {
  calls = 0;
  async generateStructured<T>(): Promise<T> {
    this.calls += 1;
    throw new ProviderUnavailableError('llm down');
  }
}

export class FakeEmbedder implements EmbeddingClient {
  calls = 0;
  constructor(private readonly vector: number[] = [1, 0, 0, 0, 0, 0, 0, 0]) {}
  async embed(texts: readonly string[]): Promise<readonly number[][]> {
    this.calls += 1;
    return texts.map(() => this.vector);
  }
}

export class UnavailableEmbedder implements EmbeddingClient {
  calls = 0;
  async embed(): Promise<readonly number[][]> {
    this.calls += 1;
    throw new ProviderUnavailableError('embedding down');
  }
}

/** Reranker that returns the reverse of the input order so reordering is visible. */
export class ReversingReranker implements RerankerClient {
  calls = 0;
  async rerank(_query: string, passages: readonly string[]): Promise<readonly number[]> {
    this.calls += 1;
    return passages.map((_passage, index) => index);
  }
}

export class IdentityReranker implements RerankerClient {
  calls = 0;
  async rerank(_query: string, passages: readonly string[]): Promise<readonly number[]> {
    this.calls += 1;
    return passages.map((_passage, index) => passages.length - index);
  }
}

export class UnavailableReranker implements RerankerClient {
  calls = 0;
  async rerank(): Promise<readonly number[]> {
    this.calls += 1;
    throw new ProviderUnavailableError('reranker down');
  }
}

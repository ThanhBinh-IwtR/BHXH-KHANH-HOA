export interface ProviderCallOptions {
  /** Propagated from the browser request and the server-side request budget. */
  signal?: AbortSignal;
}

export interface LlmClient {
  generateStructured<T>(
    input: { system: string; user: string; schemaName: string },
    options?: ProviderCallOptions,
  ): Promise<T>;
}

export interface EmbeddingClient {
  embed(texts: readonly string[], options?: ProviderCallOptions): Promise<readonly number[][]>;
}

export interface RerankerClient {
  rerank(
    query: string,
    passages: readonly string[],
    options?: ProviderCallOptions,
  ): Promise<readonly number[]>;
}

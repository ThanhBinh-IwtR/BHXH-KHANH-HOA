export interface ProviderCallOptions {
  /** Propagated from the browser request and the server-side request budget. */
  signal?: AbortSignal;
  /**
   * Stage budget for this call. Adapters use the smaller of this value and
   * their configured provider timeout, so one stage cannot consume the whole
   * request budget.
   */
  timeoutMs?: number;
}

/** Non-sensitive completion metadata reported by the generation provider. */
export interface LlmUsage {
  finishReason: string | null;
  completionTokens: number | null;
}

export interface LlmCallOptions extends ProviderCallOptions {
  /** Receives provider stop reason and token usage; never prompt or output text. */
  onUsage?: (usage: LlmUsage) => void;
}

export interface LlmClient {
  generateStructured<T>(
    input: { system: string; user: string; schemaName: string },
    options?: LlmCallOptions,
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

/** Resolve the effective stage budget from the adapter default and a call override. */
export function stageTimeoutMs(configuredMs: number, options: ProviderCallOptions = {}): number {
  const override = options.timeoutMs;
  if (override === undefined || !Number.isFinite(override)) return configuredMs;
  return Math.max(1, Math.min(configuredMs, override));
}

import type { ProviderCallOptions, RerankerClient } from './contracts';
import { getProviderStatus, ProviderUnavailableError } from './errors';
import { huggingFaceModelEndpoint } from './huggingface-endpoint';
import { parseRetryAfterMs, withTimeout } from './with-timeout';

export interface HuggingFaceRerankerOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Reranker client for a cross-encoder scoring endpoint
 * (e.g. BAAI/bge-reranker-v2-m3). Returns one relevance score per passage.
 */
export class HuggingFaceRerankerClient implements RerankerClient {
  private readonly options: HuggingFaceRerankerOptions;
  private readonly fetchImpl: typeof fetch;
  private disabledStatus: 401 | 403 | null = null;

  constructor(options: HuggingFaceRerankerOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async rerank(
    query: string,
    passages: readonly string[],
    callOptions: ProviderCallOptions = {},
  ): Promise<readonly number[]> {
    if (passages.length === 0) return [];
    if (this.disabledStatus) {
      throw new ProviderUnavailableError(
        'Reranker provider is disabled for this server session',
        { status: this.disabledStatus },
      );
    }
    try {
      return await withTimeout(async (signal) => {
        const response = await this.fetchImpl(
          huggingFaceModelEndpoint(this.options.baseUrl, this.options.model),
          {
            method: 'POST',
            signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.options.apiKey}`,
            },
            body: JSON.stringify({
              inputs: { source_sentence: query, sentences: [...passages] },
            }),
          },
        );
        if (!response.ok) {
          throw Object.assign(new Error(`Reranker HTTP ${response.status}`), {
            status: response.status,
            retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
          });
        }
        const payload = (await response.json()) as number[] | { score: number }[];
        const scores = Array.isArray(payload)
          ? payload.map((entry) => (typeof entry === 'number' ? entry : entry.score))
          : [];
        if (scores.length !== passages.length) {
          throw new ProviderUnavailableError('Reranker response shape was invalid');
        }
        return scores;
      }, { timeoutMs: this.options.timeoutMs, signal: callOptions.signal });
    } catch (error) {
      const status = getProviderStatus(error);
      if (status === 401 || status === 403) this.disabledStatus = status;
      throw error;
    }
  }
}

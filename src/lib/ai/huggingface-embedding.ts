import type { EmbeddingClient, ProviderCallOptions } from './contracts';
import { getProviderStatus, ProviderUnavailableError } from './errors';
import { huggingFaceModelEndpoint, huggingFaceStageOptions } from './huggingface-endpoint';
import { parseRetryAfterMs, withTimeout } from './with-timeout';

export interface HuggingFaceEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** Embedding client for Hugging Face's feature-extraction task endpoint. */
export class HuggingFaceEmbeddingClient implements EmbeddingClient {
  private readonly options: HuggingFaceEmbeddingOptions;
  private readonly fetchImpl: typeof fetch;
  private disabledStatus: 401 | 403 | null = null;

  constructor(options: HuggingFaceEmbeddingOptions) {
    this.options = options;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(
    texts: readonly string[],
    callOptions: ProviderCallOptions = {},
  ): Promise<readonly number[][]> {
    if (texts.length === 0) return [];
    if (this.disabledStatus) {
      throw new ProviderUnavailableError(
        'Embedding provider is disabled for this server session',
        { status: this.disabledStatus },
      );
    }
    try {
      return await withTimeout(async (signal) => {
        const response = await this.fetchImpl(
          huggingFaceModelEndpoint(
            this.options.baseUrl,
            this.options.model,
            'feature-extraction',
          ),
          {
            method: 'POST',
            signal,
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.options.apiKey}`,
            },
            body: JSON.stringify({ inputs: [...texts] }),
          },
        );
        if (!response.ok) {
          throw Object.assign(new Error(`Embedding HTTP ${response.status}`), {
            status: response.status,
            retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
          });
        }
        const payload = (await response.json()) as unknown;
        const vectors = parseEmbeddingPayload(payload, texts.length);
        if (!vectors || vectors.length !== texts.length) {
          throw new ProviderUnavailableError('Embedding response shape was invalid');
        }
        return vectors;
      }, huggingFaceStageOptions(this.options.timeoutMs, callOptions));
    } catch (error) {
      const status = getProviderStatus(error);
      if (status === 401 || status === 403) this.disabledStatus = status;
      throw error;
    }
  }
}

function parseEmbeddingPayload(payload: unknown, inputCount: number): number[][] | null {
  if (inputCount === 1 && isFiniteVector(payload)) return [payload];
  if (!Array.isArray(payload)) return null;

  if (inputCount === 1) {
    const vector = poolEmbedding(payload);
    return vector ? [vector] : null;
  }
  if (payload.length !== inputCount) return null;

  const vectors = payload.map((entry) => poolEmbedding(entry));
  return vectors.every((vector): vector is number[] => vector !== null) ? vectors : null;
}

function poolEmbedding(value: unknown): number[] | null {
  if (isFiniteVector(value)) return value;
  if (!Array.isArray(value) || value.length === 0) return null;
  const vectors = value.map((entry) => (isFiniteVector(entry) ? entry : null));
  if (!vectors.every((vector): vector is number[] => vector !== null)) return null;
  const dimensions = vectors[0]?.length ?? 0;
  if (dimensions === 0 || vectors.some((vector) => vector.length !== dimensions)) return null;
  return Array.from({ length: dimensions }, (_, index) =>
    vectors.reduce((sum, vector) => sum + vector[index], 0) / vectors.length,
  );
}

function isFiniteVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}

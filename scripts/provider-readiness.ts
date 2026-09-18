import { loadEnvConfig } from '@next/env';

import { HuggingFaceEmbeddingClient } from '@/lib/ai/huggingface-embedding';
import { HuggingFaceRerankerClient } from '@/lib/ai/huggingface-reranker';
import { OpenAiCompatibleLlm } from '@/lib/ai/openai-compatible-llm';
import { getProviderStatus } from '@/lib/ai/errors';
import { getServerEnv } from '@/lib/config/env';

type ProviderName = 'embedding' | 'reranker' | 'generation';
type ProbeStatus = 'ready' | 'unavailable';

interface ProbeResult {
  provider: ProviderName;
  model: string;
  status: ProbeStatus;
  latencyMs: number;
  httpStatus?: number;
  errorClass?: 'permission_denied' | 'rate_limited' | 'timeout' | 'provider_error';
}

function classifyError(error: unknown): ProbeResult['errorClass'] {
  const status = getProviderStatus(error);
  if (status === 401 || status === 403) return 'permission_denied';
  if (status === 429) return 'rate_limited';
  if (error instanceof Error && /timeout|time budget/i.test(error.message)) return 'timeout';
  return 'provider_error';
}

async function probe(
  provider: ProviderName,
  model: string,
  operation: () => Promise<unknown>,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    await operation();
    return { provider, model, status: 'ready', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      provider,
      model,
      status: 'unavailable',
      latencyMs: Date.now() - started,
      httpStatus: getProviderStatus(error),
      errorClass: classifyError(error),
    };
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    console.log(JSON.stringify({ status: 'unavailable', error: 'invalid_configuration' }, null, 2));
    process.exitCode = 1;
    return;
  }

  const embedding = new HuggingFaceEmbeddingClient({
    baseUrl: env.embedding.baseUrl,
    apiKey: env.embedding.apiKey,
    model: env.embedding.model,
    timeoutMs: env.aiTimeoutMs,
  });
  const reranker = new HuggingFaceRerankerClient({
    baseUrl: env.reranker.baseUrl,
    apiKey: env.reranker.apiKey,
    model: env.reranker.model,
    timeoutMs: env.aiTimeoutMs,
  });
  const generator = new OpenAiCompatibleLlm({
    baseUrl: env.llm.baseUrl,
    apiKey: env.llm.apiKey,
    model: env.llm.model,
    timeoutMs: env.aiTimeoutMs,
    thinkingMode: env.llm.thinkingMode,
    maxOutputTokens: Math.min(env.llm.maxOutputTokens ?? 256, 256),
  });

  const results = await Promise.all([
    probe('embedding', env.embedding.model, () => embedding.embed(['readiness probe'])),
    probe('reranker', env.reranker.model, () => reranker.rerank('readiness probe', ['probe passage'])),
    probe('generation', env.llm.model, () =>
      generator.generateStructured({
        system: 'Return a JSON object with the boolean field ok.',
        user: 'Return {"ok":true}.',
        schemaName: 'readiness_probe',
      }),
    ),
  ]);

  const generationReady = results.find((result) => result.provider === 'generation')?.status === 'ready';
  const semanticReady = results
    .filter((result) => result.provider !== 'generation')
    .every((result) => result.status === 'ready');
  const status = generationReady ? (semanticReady ? 'ready' : 'degraded-keyword-only') : 'unavailable';
  console.log(JSON.stringify({ status, providers: results }, null, 2));
  process.exitCode = status === 'ready' ? 0 : 1;
}

void main();

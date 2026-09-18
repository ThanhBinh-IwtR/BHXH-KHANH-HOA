import 'server-only';

import { HuggingFaceEmbeddingClient } from '@/lib/ai/huggingface-embedding';
import { HuggingFaceRerankerClient } from '@/lib/ai/huggingface-reranker';
import { OpenAiCompatibleLlm } from '@/lib/ai/openai-compatible-llm';
import { getServerEnv } from '@/lib/config/env';
import { getLegalRepository, resetLegalRepository } from '@/lib/db/repository-factory';

import type { RagServiceDeps } from './service';

let cached: RagServiceDeps | null = null;

/** Build the RAG dependency graph from validated server configuration. */
export function createRagDeps(): RagServiceDeps {
  if (cached) return cached;
  const env = getServerEnv();
  cached = {
    repository: getLegalRepository(),
    embedder: new HuggingFaceEmbeddingClient({
      baseUrl: env.embedding.baseUrl,
      apiKey: env.embedding.apiKey,
      model: env.embedding.model,
      timeoutMs: env.aiTimeoutMs,
    }),
    reranker: new HuggingFaceRerankerClient({
      baseUrl: env.reranker.baseUrl,
      apiKey: env.reranker.apiKey,
      model: env.reranker.model,
      timeoutMs: env.aiTimeoutMs,
    }),
    generator: new OpenAiCompatibleLlm({
      baseUrl: env.llm.baseUrl,
      apiKey: env.llm.apiKey,
      model: env.llm.model,
      timeoutMs: env.aiTimeoutMs,
      thinkingMode: env.llm.thinkingMode,
      maxOutputTokens: env.llm.maxOutputTokens,
    }),
    corpusVersion: env.corpusVersion,
    requestTimeoutMs: env.requestTimeoutMs,
  };
  return cached;
}

/** Test/deployment hook: rebuild the dependency graph after env changes. */
export function resetRagDeps(): void {
  cached = null;
  resetLegalRepository();
}

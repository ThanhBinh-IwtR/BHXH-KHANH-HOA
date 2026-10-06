import { stageTimeoutMs, type ProviderCallOptions } from './contracts';
import type { TimeoutOptions } from './with-timeout';

export function huggingFaceModelEndpoint(
  baseUrl: string,
  model: string,
  task?: 'feature-extraction',
): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const inferenceBaseUrl = normalizedBaseUrl.endsWith('/hf-inference')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/hf-inference`;
  const modelEndpoint = `${inferenceBaseUrl}/models/${model}`;
  return task ? `${modelEndpoint}/pipeline/${task}` : modelEndpoint;
}

/**
 * Embedding/reranking calls are short. Split their stage budget so a hung first
 * attempt still leaves time for the single permitted retry.
 */
export function huggingFaceStageOptions(
  configuredMs: number,
  callOptions: ProviderCallOptions,
): TimeoutOptions {
  const timeoutMs = stageTimeoutMs(configuredMs, callOptions);
  return { timeoutMs, attemptTimeoutMs: Math.ceil(timeoutMs / 2), signal: callOptions.signal };
}

import { afterEach, describe, expect, it } from 'vitest';
import { getServerEnv } from '@/lib/config/env';

const originalEnv = { ...process.env };

const validEnv = {
  LEGAL_REPOSITORY: 'memory',
  CORPUS_VERSION: '2025-demo-v1',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'service-key',
  LLM_BASE_URL: 'https://openrouter.ai/api/v1',
  LLM_API_KEY: 'llm-key',
  LLM_MODEL: 'google/gemma-4-31b-it:free',
  LLM_THINKING_MODE: 'disabled',
  LLM_MAX_OUTPUT_TOKENS: '512',
  EMBEDDING_BASE_URL: 'https://router.huggingface.co',
  EMBEDDING_API_KEY: 'embedding-key',
  EMBEDDING_MODEL: 'BAAI/bge-m3',
  RERANKER_BASE_URL: 'https://router.huggingface.co',
  RERANKER_API_KEY: 'reranker-key',
  RERANKER_MODEL: 'BAAI/bge-reranker-v2-m3',
  AI_TIMEOUT_MS: '15000',
  RATE_LIMIT_SALT: 'rate-limit-salt',
};

function replaceEnv(env: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

afterEach(() => replaceEnv(originalEnv));

describe('getServerEnv', () => {
  it('returns validated server configuration', () => {
    replaceEnv(validEnv);

    expect(getServerEnv()).toMatchObject({
      legalRepository: 'memory',
      corpusVersion: '2025-demo-v1',
      aiTimeoutMs: 15000,
      llm: {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'llm-key',
        model: 'google/gemma-4-31b-it:free',
        thinkingMode: 'disabled',
        maxOutputTokens: 512,
      },
    });
  });

  it('rejects a missing provider secret', () => {
    replaceEnv({ ...validEnv, LLM_API_KEY: undefined });

    expect(() => getServerEnv()).toThrow();
  });

  it('boots in memory mode without Supabase credentials', () => {
    replaceEnv({ ...validEnv, SUPABASE_URL: undefined, SUPABASE_SERVICE_KEY: undefined });

    expect(getServerEnv().legalRepository).toBe('memory');
  });

  it('rejects an unknown legal repository instead of silently selecting memory', () => {
    replaceEnv({ ...validEnv, LEGAL_REPOSITORY: 'unknown' });

    expect(() => getServerEnv()).toThrow(/LEGAL_REPOSITORY/i);
  });

  it('requires Supabase credentials when the repository is supabase', () => {
    replaceEnv({
      ...validEnv,
      LEGAL_REPOSITORY: 'supabase',
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_KEY: undefined,
    });

    expect(() => getServerEnv()).toThrow();
  });

  it.each(['not-a-url', ''])('rejects an invalid provider URL: %s', (LLM_BASE_URL) => {
    replaceEnv({ ...validEnv, LLM_BASE_URL });

    expect(() => getServerEnv()).toThrow();
  });

  it.each(['', '   '])('rejects an empty model name: %s', (LLM_MODEL) => {
    replaceEnv({ ...validEnv, LLM_MODEL });

    expect(() => getServerEnv()).toThrow();
  });

  it.each(['999', '60001', 'invalid'])('rejects an out-of-range timeout: %s', (AI_TIMEOUT_MS) => {
    replaceEnv({ ...validEnv, AI_TIMEOUT_MS });

    expect(() => getServerEnv()).toThrow();
  });

  it.each(['0', '1001', 'invalid'])('rejects an invalid rate-limit maximum: %s', (RATE_LIMIT_MAX) => {
    replaceEnv({ ...validEnv, RATE_LIMIT_MAX });

    expect(() => getServerEnv()).toThrow(/RATE_LIMIT_MAX/i);
  });

  it.each(['999', '3600001', 'invalid'])('rejects an invalid rate-limit window: %s', (RATE_LIMIT_WINDOW_MS) => {
    replaceEnv({ ...validEnv, RATE_LIMIT_WINDOW_MS });

    expect(() => getServerEnv()).toThrow(/RATE_LIMIT_WINDOW_MS/i);
  });

  it('returns bounded request and rate-limit configuration defaults', () => {
    replaceEnv(validEnv);

    expect(getServerEnv()).toMatchObject({
      requestTimeoutMs: 25000,
      rateLimit: { max: 20, windowMs: 60000 },
    });
  });

  it('rejects a provider timeout above 60% of the request budget', () => {
    replaceEnv({ ...validEnv, AI_TIMEOUT_MS: '60000', REQUEST_TIMEOUT_MS: '60000' });

    expect(() => getServerEnv()).toThrow(/AI_TIMEOUT_MS.*60% of REQUEST_TIMEOUT_MS/);
  });

  it('accepts the documented demo timeouts (36 s provider, 60 s request)', () => {
    replaceEnv({ ...validEnv, AI_TIMEOUT_MS: '36000', REQUEST_TIMEOUT_MS: '60000' });

    expect(getServerEnv()).toMatchObject({ aiTimeoutMs: 36000, requestTimeoutMs: 60000 });
  });

  it('supports a 60-second request budget for slower free providers', () => {
    replaceEnv({ ...validEnv, REQUEST_TIMEOUT_MS: '60000' });

    expect(getServerEnv().requestTimeoutMs).toBe(60000);
  });
});

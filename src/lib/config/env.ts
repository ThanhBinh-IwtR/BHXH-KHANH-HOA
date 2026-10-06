import 'server-only';

import { z } from 'zod';

const requiredText = z.string().trim().min(1);
const requiredUrl = z.string().url();
const legalRepositorySchema = z.enum(['memory', 'supabase']).default('memory');
const rateLimitMaxSchema = z.coerce.number().int().min(1).max(1_000).default(20);
const rateLimitWindowSchema = z.coerce.number().int().min(1_000).max(3_600_000).default(60_000);
const requestTimeoutSchema = z.coerce.number().int().min(1_000).max(60_000).default(25_000);
/**
 * One provider stage may use at most 60% of the request budget: embedding and
 * reranking are each capped at 15%, so a full-length generation still leaves
 * about 10% headroom before the request deadline.
 */
const MAX_PROVIDER_TIMEOUT_SHARE = 0.6;

const serverEnvSchema = z
  .object({
    LEGAL_REPOSITORY: legalRepositorySchema,
    CORPUS_VERSION: requiredText,
    SUPABASE_URL: z.string().optional().default(''),
    SUPABASE_SERVICE_KEY: z.string().optional().default(''),
    LLM_BASE_URL: requiredUrl,
    LLM_API_KEY: requiredText,
    LLM_MODEL: requiredText,
    LLM_THINKING_MODE: z.enum(['enabled', 'disabled']).optional(),
    LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8_192).optional(),
    EMBEDDING_BASE_URL: requiredUrl,
    EMBEDDING_API_KEY: requiredText,
    EMBEDDING_MODEL: requiredText,
    RERANKER_BASE_URL: requiredUrl,
    RERANKER_API_KEY: requiredText,
    RERANKER_MODEL: requiredText,
    AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000),
    REQUEST_TIMEOUT_MS: requestTimeoutSchema,
    RATE_LIMIT_MAX: rateLimitMaxSchema,
    RATE_LIMIT_WINDOW_MS: rateLimitWindowSchema,
    RATE_LIMIT_SALT: requiredText,
  })
  .superRefine((env, ctx) => {
    const maxProviderTimeoutMs = Math.floor(env.REQUEST_TIMEOUT_MS * MAX_PROVIDER_TIMEOUT_SHARE);
    if (env.AI_TIMEOUT_MS > maxProviderTimeoutMs) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_TIMEOUT_MS'],
        message: `AI_TIMEOUT_MS (${env.AI_TIMEOUT_MS}) must be at most 60% of REQUEST_TIMEOUT_MS (${env.REQUEST_TIMEOUT_MS}), i.e. <= ${maxProviderTimeoutMs}`,
      });
    }
    // Supabase credentials are only required when it is the active repository;
    // memory mode (default) boots without them.
    if (env.LEGAL_REPOSITORY === 'supabase') {
      if (!z.string().url().safeParse(env.SUPABASE_URL).success) {
        ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'Valid SUPABASE_URL required for supabase repository' });
      }
      if (!env.SUPABASE_SERVICE_KEY.trim()) {
        ctx.addIssue({ code: 'custom', path: ['SUPABASE_SERVICE_KEY'], message: 'SUPABASE_SERVICE_KEY required for supabase repository' });
      }
    }
  });

export type ServerEnv = ReturnType<typeof getServerEnv>;

export interface RateLimitConfig {
  max: number;
  windowMs: number;
  salt: string;
}

const rateLimitEnvSchema = z.object({
  RATE_LIMIT_MAX: rateLimitMaxSchema,
  RATE_LIMIT_WINDOW_MS: rateLimitWindowSchema,
  RATE_LIMIT_SALT: requiredText,
});

export function getRateLimitConfig(): RateLimitConfig {
  const env = rateLimitEnvSchema.parse(process.env);
  return {
    max: env.RATE_LIMIT_MAX,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    salt: env.RATE_LIMIT_SALT,
  };
}

export function getServerEnv() {
  const env = serverEnvSchema.parse(process.env);

  return {
    legalRepository: env.LEGAL_REPOSITORY,
    corpusVersion: env.CORPUS_VERSION,
    supabase: {
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    },
    llm: {
      baseUrl: env.LLM_BASE_URL,
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
      thinkingMode: env.LLM_THINKING_MODE,
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
    },
    embedding: {
      baseUrl: env.EMBEDDING_BASE_URL,
      apiKey: env.EMBEDDING_API_KEY,
      model: env.EMBEDDING_MODEL,
    },
    reranker: {
      baseUrl: env.RERANKER_BASE_URL,
      apiKey: env.RERANKER_API_KEY,
      model: env.RERANKER_MODEL,
    },
    aiTimeoutMs: env.AI_TIMEOUT_MS,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
    rateLimit: {
      max: env.RATE_LIMIT_MAX,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    },
    rateLimitSalt: env.RATE_LIMIT_SALT,
  };
}

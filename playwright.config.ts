import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

const DETERMINISTIC_WEB_SERVER_ENV: Record<string, string> = {
  LEGAL_REPOSITORY: 'memory',
  CORPUS_VERSION: '2025-demo-v1',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test',
  LLM_BASE_URL: 'https://example.com/v1',
  LLM_API_KEY: 'test',
  LLM_MODEL: 'test-model',
  EMBEDDING_BASE_URL: 'https://example.com',
  EMBEDDING_API_KEY: 'test',
  EMBEDDING_MODEL: 'test-embed',
  RERANKER_BASE_URL: 'https://example.com',
  RERANKER_API_KEY: 'test',
  RERANKER_MODEL: 'test-rerank',
  AI_TIMEOUT_MS: '30000',
  RATE_LIMIT_SALT: 'e2e-salt',
};

/** Keep deterministic E2E isolated from real providers unless explicitly opted in. */
export function getWebServerEnv(
  environment: Record<string, string | undefined> = process.env,
): Record<string, string> | undefined {
  return environment.RUN_LIVE_E2E === '1' ? undefined : DETERMINISTIC_WEB_SERVER_ENV;
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'mobile360', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: getWebServerEnv(),
  },
});

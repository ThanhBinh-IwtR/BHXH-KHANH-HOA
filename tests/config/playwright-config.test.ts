import { describe, expect, it } from 'vitest';

import { getWebServerEnv } from '../../playwright.config';

describe('Playwright web server environment', () => {
  it('does not overwrite provider configuration for an explicitly enabled live run', () => {
    expect(
      getWebServerEnv({
        RUN_LIVE_E2E: '1',
        LLM_BASE_URL: 'https://provider.example/v1',
        LLM_API_KEY: 'placeholder',
      }),
    ).toBeUndefined();
  });

  it('uses deterministic fake providers for the default E2E run', () => {
    const env = getWebServerEnv({});

    expect(env?.LLM_BASE_URL).toBe('https://example.com/v1');
    expect(env?.LLM_API_KEY).toBe('test');
    expect(env?.LEGAL_REPOSITORY).toBe('memory');
  });
});

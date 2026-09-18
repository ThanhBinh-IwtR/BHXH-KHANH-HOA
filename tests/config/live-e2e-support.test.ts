import { describe, expect, it } from 'vitest';

import { isProviderBlockedStatus } from '../../tests/e2e/live-e2e-support';

describe('live provider status handling', () => {
  it('treats known provider quota, permission and timeout statuses as a blocked sample', () => {
    for (const status of [401, 403, 429, 504]) {
      expect(isProviderBlockedStatus(status)).toBe(true);
    }
  });

  it('does not hide successful or unexpected server responses', () => {
    expect(isProviderBlockedStatus(200)).toBe(false);
    expect(isProviderBlockedStatus(503)).toBe(false);
  });
});

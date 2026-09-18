import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('credentialed evaluation CLI', () => {
  it('loads server-only modules with the React server condition', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts?: { evaluate?: string } };

    expect(packageJson.scripts?.evaluate).toContain('node --conditions=react-server --import tsx');
  });

  it('loads the project environment before creating credentialed dependencies', () => {
    const runner = readFileSync(
      resolve(process.cwd(), 'tests/evaluation/run-evaluation.ts'),
      'utf8',
    );

    expect(runner).toContain('loadEnvConfig');
  });
});

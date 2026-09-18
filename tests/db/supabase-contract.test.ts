import { describe } from 'vitest';

import { SupabaseLegalRepository } from '@/lib/db/supabase-legal-repository';
import { sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { repositoryContract } from './repository-contract';

const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_KEY;
const hasBothCredentials = Boolean(url) && Boolean(serviceKey);

// Runs only when BOTH credentials are present. No partial-credential mode.
const suite = hasBothCredentials ? describe : describe.skip;

suite('SupabaseLegalRepository (integration)', () => {
  repositoryContract(
    () =>
      new SupabaseLegalRepository({
        url: url as string,
        serviceKey: serviceKey as string,
        corpusVersion: sampleCorpusVersion,
      }),
  );
});

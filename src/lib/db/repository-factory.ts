import 'server-only';

import { getServerEnv } from '@/lib/config/env';

import type { LegalRepository } from './legal-repository';
import { MemoryLegalRepository } from './memory-legal-repository';
import { sampleCorpus } from './sample-corpus';
import { SupabaseLegalRepository } from './supabase-legal-repository';

let cached: LegalRepository | null = null;

/** Resolve only the repository explicitly selected by validated configuration. */
export function getLegalRepository(): LegalRepository {
  if (cached) return cached;
  const env = getServerEnv();
  switch (env.legalRepository) {
    case 'supabase':
      cached = new SupabaseLegalRepository({
        url: env.supabase.url,
        serviceKey: env.supabase.serviceKey,
        corpusVersion: env.corpusVersion,
      });
      break;
    case 'memory':
      cached = new MemoryLegalRepository(sampleCorpus);
      break;
    default: {
      const impossibleRepository: never = env.legalRepository;
      throw new Error(`Unsupported LEGAL_REPOSITORY: ${impossibleRepository}`);
    }
  }
  return cached;
}

/** Test hook to reset the cached singleton between suites. */
export function resetLegalRepository(): void {
  cached = null;
}

import { describe, expect, it, vi } from 'vitest';

import type { RagServiceDeps } from '@/features/legal-rag/service';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { FakeEmbedder, FakeLlm, IdentityReranker } from '../legal-rag/fakes';

const state = vi.hoisted(() => ({ deps: null as unknown as RagServiceDeps }));
vi.mock('@/features/legal-rag/service-factory', () => ({ createRagDeps: () => state.deps }));

import { GET } from '@/app/api/documents/route';

state.deps = {
  repository: new MemoryLegalRepository(sampleCorpus),
  embedder: new FakeEmbedder(),
  reranker: new IdentityReranker(),
  generator: new FakeLlm([]),
  corpusVersion: sampleCorpusVersion,
};

describe('GET /api/documents', () => {
  it('returns exactly the four active documents without secrets', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.documents).toHaveLength(4);
    expect(json.documents.map((d: { documentNumber: string }) => d.documentNumber)).toContain(
      '188/2025/NĐ-CP',
    );
    expect(json.documents[0]).toHaveProperty('pdfUrl');
    expect(json.documents[0]).not.toHaveProperty('embedding');
  });
});

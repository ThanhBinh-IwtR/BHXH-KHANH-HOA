import { describe, expect, it, vi } from 'vitest';

import type { RagServiceDeps } from '@/features/legal-rag/service';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import type { LegalRepository } from '@/lib/db/legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { FakeEmbedder, FakeLlm, IdentityReranker } from '../legal-rag/fakes';

const state = vi.hoisted(() => ({ deps: null as unknown as RagServiceDeps }));
vi.mock('@/features/legal-rag/service-factory', () => ({ createRagDeps: () => state.deps }));

import { GET } from '@/app/api/sources/[id]/route';

state.deps = {
  repository: new MemoryLegalRepository(sampleCorpus),
  embedder: new FakeEmbedder(),
  reranker: new IdentityReranker(),
  generator: new FakeLlm([]),
  corpusVersion: sampleCorpusVersion,
};

function get(id: string) {
  return GET(new Request(`http://localhost/api/sources/${id}`) as never, {
    params: Promise.resolve({ id }),
  });
}

describe('GET /api/sources/:id', () => {
  it('returns the verbatim source body and a page-anchored PDF url', async () => {
    const response = await get('nd-158-2025:dieu-12:khoan-3:2025-demo-v1');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.documentNumber).toBe('158/2025/NĐ-CP');
    expect(json.bodyText).toContain('17%');
    expect(json.pdfUrl).toContain('#page=8');
  });

  it('returns 404 for an unknown source', async () => {
    const response = await get('nd-158-2025:dieu-999:v1');
    expect(response.status).toBe(404);
  });

  it('uses the corpus allowlist instead of a persisted arbitrary PDF URL', async () => {
    const repository = new MemoryLegalRepository(sampleCorpus);
    const originalGetDocuments = repository.getDocuments.bind(repository);
    state.deps = {
      ...state.deps,
      repository: {
        getDocuments: async () =>
          (await originalGetDocuments()).map((document) =>
            document.documentId === 'nd-158-2025'
              ? { ...document, pdfUrl: 'https://example.invalid/attacker.pdf' }
              : document,
          ),
        getSource: repository.getSource.bind(repository),
        exactSearch: repository.exactSearch.bind(repository),
        keywordSearch: repository.keywordSearch.bind(repository),
        hybridSearch: repository.hybridSearch.bind(repository),
        getRelated: repository.getRelated.bind(repository),
      } as LegalRepository,
    };

    const response = await get('nd-158-2025:dieu-12:khoan-3:2025-demo-v1');
    const json = await response.json();
    expect(json.pdfUrl).toBe('/corpus/158_2025_ND-CP_25062025-signed.pdf#page=8');
  });

  it.each([
    ['nd-157-2025:dieu-1:2025-demo-v1', '157_2025_ND-CP_25062025-signed.pdf#page=1'],
    ['nd-158-2025:dieu-12:khoan-3:2025-demo-v1', '158_2025_ND-CP_25062025-signed.pdf#page=8'],
    ['nd-159-2025:dieu-5:khoan-1:2025-demo-v1', '159_2025_ND-CP_25062025-signed.pdf#page=4'],
    ['nd-188-2025:dieu-7:khoan-1:2025-demo-v1', '188_2025_ND-CP_01072025-signed.pdf#page=5'],
  ])('maps %s to its controlled PDF', async (sourceId, expectedSuffix) => {
    state.deps = {
      ...state.deps,
      repository: new MemoryLegalRepository(sampleCorpus),
    };
    const response = await get(sourceId);
    expect(response.status).toBe(200);
    expect((await response.json()).pdfUrl).toBe(`/corpus/${expectedSuffix}`);
  });
});

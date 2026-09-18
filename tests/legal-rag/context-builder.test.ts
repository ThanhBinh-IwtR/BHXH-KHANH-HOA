import { describe, expect, it } from 'vitest';

import { buildContext } from '@/features/legal-rag/context-builder';
import type { EvidenceSet } from '@/features/legal-rag/retrieval';
import type { LegalRepository } from '@/lib/db/legal-repository';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus } from '@/lib/db/sample-corpus';

function evidenceFrom(chunkIds: string[]): EvidenceSet {
  const chunks = chunkIds
    .map((id) => sampleCorpus.chunks.find((chunk) => chunk.chunkId === id)!)
    .map((chunk) => ({
      chunk,
      exactMatch: false,
      keywordRank: 1,
      vectorRank: 1,
      fusedScore: 1,
      rerankerScore: 1,
    }));
  return {
    reference: null,
    chunks,
    usedKeywordFallback: false,
    rerankerFailed: false,
    evidenceStrength: 'keyword',
    hasAcceptableEvidence: true,
  };
}

describe('buildContext', () => {
  it('deduplicates and orders sources by legal coordinate', async () => {
    const repository = new MemoryLegalRepository(sampleCorpus);
    const context = await buildContext(
      evidenceFrom([
        'nd-158-2025:dieu-12:khoan-3:2025-demo-v1',
        'nd-158-2025:dieu-12:khoan-1:2025-demo-v1',
        'nd-158-2025:dieu-12:khoan-3:2025-demo-v1',
      ]),
      repository,
    );
    expect(context.sourceIds).toEqual([
      'nd-158-2025:dieu-12:khoan-1:2025-demo-v1',
      'nd-158-2025:dieu-12:khoan-3:2025-demo-v1',
    ]);
    expect(context.contextText).toContain('nd-158-2025:dieu-12:khoan-1:2025-demo-v1');
  });

  it('never exceeds the configured token budget', async () => {
    const repository = new MemoryLegalRepository(sampleCorpus);
    const context = await buildContext(
      evidenceFrom([
        'nd-158-2025:dieu-12:khoan-3:2025-demo-v1',
        'nd-159-2025:dieu-5:khoan-1:2025-demo-v1',
        'nd-188-2025:dieu-7:khoan-1:2025-demo-v1',
      ]),
      repository,
      { maxTokens: 60 },
    );
    expect(context.tokenEstimate).toBeLessThanOrEqual(60);
    expect(context.sources.length).toBeGreaterThan(0);
  });

  it('produces citation labels without similarity scores', async () => {
    const repository = new MemoryLegalRepository(sampleCorpus);
    const context = await buildContext(
      evidenceFrom(['nd-158-2025:dieu-12:khoan-3:2025-demo-v1']),
      repository,
    );
    expect(context.sources[0].label).toBe('158/2025/NĐ-CP · Điều 12 · Khoản 3');
  });

  it('ignores missing, duplicate and cross-version relation results', async () => {
    const base = sampleCorpus.chunks[0];
    const primary = { ...base, parentId: 'parent-1', crossReferenceIds: ['missing-1', 'parent-1'] };
    const sameVersion = { ...base, chunkId: 'parent-1', clauseNumber: null, bodyText: 'Ngữ cảnh cùng corpus.' };
    const otherVersion = { ...sameVersion, chunkId: 'other-version', corpusVersion: 'other-v2' };
    const memory = new MemoryLegalRepository({ documents: sampleCorpus.documents, chunks: [primary] });
    const repository: LegalRepository = {
      getDocuments: memory.getDocuments.bind(memory),
      getSource: memory.getSource.bind(memory),
      exactSearch: memory.exactSearch.bind(memory),
      keywordSearch: memory.keywordSearch.bind(memory),
      hybridSearch: memory.hybridSearch.bind(memory),
      getRelated: async () => [sameVersion, sameVersion, otherVersion],
    };
    const evidence: EvidenceSet = {
      reference: null,
      chunks: [{
        chunk: primary,
        exactMatch: false,
        keywordRank: 1,
        vectorRank: null,
        fusedScore: 1,
        rerankerScore: null,
      }],
      usedKeywordFallback: false,
      rerankerFailed: false,
      evidenceStrength: 'keyword',
      hasAcceptableEvidence: true,
    };

    const context = await buildContext(evidence, repository);

    expect(context.sourceIds).toEqual([
      'nd-158-2025:dieu-12:khoan-3:2025-demo-v1',
      'parent-1',
    ]);
    expect(context.sourceIds).not.toContain('other-version');
  });
});

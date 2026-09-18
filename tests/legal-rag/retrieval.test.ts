import { describe, expect, it } from 'vitest';

import { retrieveEvidence } from '@/features/legal-rag/retrieval';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { FakeEmbedder, IdentityReranker, UnavailableEmbedder, UnavailableReranker } from './fakes';

function repo() {
  return new MemoryLegalRepository(sampleCorpus);
}

describe('retrieveEvidence', () => {
  it('pins an exact reference at the top of the evidence set', async () => {
    const embedder = new FakeEmbedder([3, 1, 0, 2, 0, 0, 1, 0]);
    const reranker = new IdentityReranker();
    const evidence = await retrieveEvidence(
      { query: 'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP', corpusVersion: sampleCorpusVersion },
      repo(),
      embedder,
      reranker,
    );
    expect(evidence.reference?.article).toBe('12');
    expect(evidence.chunks[0].exactMatch).toBe(true);
    expect(evidence.chunks[0].chunk.chunkId).toBe('nd-158-2025:dieu-12:khoan-3:2025-demo-v1');
    expect(embedder.calls).toBe(0);
    expect(reranker.calls).toBe(0);
  });

  it('retrieves natural-language evidence through hybrid search', async () => {
    const evidence = await retrieveEvidence(
      { query: 'mức đóng bảo hiểm y tế hằng tháng', corpusVersion: sampleCorpusVersion },
      repo(),
      new FakeEmbedder([0, 0, 2, 1, 3, 0, 0, 1]),
      new IdentityReranker(),
    );
    expect(evidence.chunks.length).toBeGreaterThan(0);
    expect(evidence.chunks.some((c) => c.chunk.documentNumber === '188/2025/NĐ-CP')).toBe(true);
  });

  it('keeps a topic-specific BHYT query from adding unrelated BHXH chunks', async () => {
    const evidence = await retrieveEvidence(
      { query: 'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?', corpusVersion: sampleCorpusVersion },
      repo(),
      new FakeEmbedder([0, 0, 2, 1, 3, 0, 0, 1]),
      new IdentityReranker(),
    );

    expect(evidence.chunks.length).toBeGreaterThan(0);
    expect(evidence.chunks.every((item) => item.chunk.bodyText.includes('bảo hiểm y tế'))).toBe(true);
  });

  it('keeps both domains for a comparison query', async () => {
    const evidence = await retrieveEvidence(
      {
        query: 'So sánh mức đóng bảo hiểm y tế và bảo hiểm xã hội.',
        corpusVersion: sampleCorpusVersion,
      },
      repo(),
      new FakeEmbedder([0, 0, 2, 1, 3, 0, 0, 1]),
      new IdentityReranker(),
    );

    expect(evidence.chunks.some((item) => item.chunk.bodyText.includes('bảo hiểm y tế'))).toBe(true);
    expect(evidence.chunks.some((item) => item.chunk.bodyText.includes('bảo hiểm xã hội'))).toBe(true);
  });

  it('falls back to keyword search when embedding fails and no exact hit exists', async () => {
    const evidence = await retrieveEvidence(
      { query: 'mức đóng bảo hiểm xã hội tự nguyện', corpusVersion: sampleCorpusVersion },
      repo(),
      new UnavailableEmbedder(),
      new IdentityReranker(),
    );
    expect(evidence.usedKeywordFallback).toBe(true);
    expect(evidence.chunks.length).toBeGreaterThan(0);
  });

  it('keeps candidate order when the reranker is unavailable', async () => {
    const evidence = await retrieveEvidence(
      { query: 'mức đóng bảo hiểm xã hội bắt buộc', corpusVersion: sampleCorpusVersion },
      repo(),
      new FakeEmbedder([3, 1, 0, 2, 0, 0, 1, 0]),
      new UnavailableReranker(),
    );
    expect(evidence.rerankerFailed).toBe(true);
    expect(evidence.chunks.length).toBeGreaterThan(0);
  });

  it('rejects vector-only evidence as too weak for a legal answer', async () => {
    const evidence = await retrieveEvidence(
      { query: 'Tôi cần làm hộ chiếu mới ở đâu?', corpusVersion: sampleCorpusVersion },
      repo(),
      new FakeEmbedder([1, 0, 0, 0, 0, 0, 0, 0]),
      new IdentityReranker(),
    );

    expect(evidence.chunks.length).toBeGreaterThan(0);
    expect(evidence.hasAcceptableEvidence).toBe(false);
  });

  it('does not treat a similarly spelled non-legal word as a corpus anchor', async () => {
    const evidence = await retrieveEvidence(
      { query: 'quyền lợi du lịch của tôi là gì?', corpusVersion: sampleCorpusVersion },
      repo(),
      new FakeEmbedder([1, 0, 0, 0, 0, 0, 0, 0]),
      new IdentityReranker(),
    );

    expect(evidence.hasAcceptableEvidence).toBe(false);
  });

  it('accepts an unaccented legal query when its lexical evidence is strong', async () => {
    const evidence = await retrieveEvidence(
      { query: 'muc dong bao hiem xa hoi tu nguyen hang thang', corpusVersion: sampleCorpusVersion },
      repo(),
      new FakeEmbedder([]),
      new IdentityReranker(),
    );

    expect(evidence.evidenceStrength).toBe('keyword');
    expect(evidence.hasAcceptableEvidence).toBe(true);
  });
});

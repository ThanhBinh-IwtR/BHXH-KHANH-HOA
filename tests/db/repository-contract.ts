import { expect, it } from 'vitest';

import { sampleCorpusVersion } from '@/lib/db/sample-corpus';
import type { LegalRepository } from '@/lib/db/legal-repository';

/**
 * Behavioural contract that every LegalRepository implementation must satisfy.
 * The same suite runs against the in-memory repository and (when credentials
 * exist) the Supabase repository seeded with identical data.
 */
export function repositoryContract(factory: () => LegalRepository): void {
  it('returns an exact clause by document, article, and clause', async () => {
    const rows = await factory().exactSearch({
      documentNumber: '158/2025/NĐ-CP',
      article: '12',
      clause: '3',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].chunkId).toBe('nd-158-2025:dieu-12:khoan-3:2025-demo-v1');
  });

  it('normalises document number spacing and slashes for exact lookup', async () => {
    const rows = await factory().exactSearch({
      documentNumber: '158 / 2025 / ND-CP',
      article: '12',
    });
    expect(rows.map((chunk) => chunk.clauseNumber).sort()).toEqual(['1', '3']);
  });

  it('finds chunks by accent-insensitive keyword search', async () => {
    const rows = await factory().keywordSearch('muc dong bao hiem y te', 10);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].chunk.documentNumber).toBe('188/2025/NĐ-CP');
    expect(rows.every((row) => row.keywordRank !== null)).toBe(true);
  });

  it('ranks hybrid search by fusing keyword and vector signals', async () => {
    const rows = await factory().hybridSearch({
      queryText: 'tỷ lệ đóng bảo hiểm xã hội bắt buộc',
      queryUnaccented: 'ty le dong bao hiem xa hoi bat buoc',
      queryVector: [3, 1, 0, 2, 0, 0, 1, 0],
      matchCount: 5,
      corpusVersion: sampleCorpusVersion,
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].fusedScore).toBeGreaterThan(0);
  });

  it('resolves a source and related chunks by id', async () => {
    const repository = factory();
    const source = await repository.getSource('nd-159-2025:dieu-5:khoan-1:2025-demo-v1');
    expect(source?.documentNumber).toBe('159/2025/NĐ-CP');
    const related = await repository.getRelated([
      'nd-159-2025:dieu-5:khoan-1:2025-demo-v1',
      'missing:id',
    ]);
    expect(related).toHaveLength(1);
  });

  it('lists exactly the active documents', async () => {
    const documents = await factory().getDocuments();
    expect(documents).toHaveLength(4);
    expect(documents.map((doc) => doc.documentNumber)).toContain('157/2025/NĐ-CP');
  });
}

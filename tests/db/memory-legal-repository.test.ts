import { describe, expect, it } from 'vitest';

import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { repositoryContract } from './repository-contract';

const APPENDIX_ID = 'nd-188-2025:phu-luc-1:mau-6:noi-dung:2025-demo-v1';

describe('MemoryLegalRepository', () => {
  repositoryContract(() => new MemoryLegalRepository(sampleCorpus));

  it('filters the keyword fallback by the configured corpus version, like hybrid search', async () => {
    const current = new MemoryLegalRepository(sampleCorpus, { corpusVersion: sampleCorpusVersion });
    const other = new MemoryLegalRepository(sampleCorpus, { corpusVersion: 'another-version' });

    expect((await current.keywordSearch('muc dong bao hiem y te', 10)).length).toBeGreaterThan(0);
    expect(await other.keywordSearch('muc dong bao hiem y te', 10)).toEqual([]);
  });

  describe('appendix exclusion', () => {
    const repo = () => new MemoryLegalRepository(sampleCorpus);

    it('has an appendix chunk in the dataset to exercise the guard', () => {
      expect(sampleCorpus.chunks.some((chunk) => chunk.chunkId === APPENDIX_ID)).toBe(true);
    });

    it('never returns a form template from keyword search', async () => {
      const rows = await repo().keywordSearch('mẫu số 6 biên bản thanh lý hợp đồng', 10);
      expect(rows.every((row) => row.chunk.chunkId !== APPENDIX_ID)).toBe(true);
    });

    it('never returns a form template from hybrid search, even with a matching vector', async () => {
      // This query vector is identical to the appendix chunk's embedding.
      const rows = await repo().hybridSearch({
        queryText: 'mức đóng bảo hiểm y tế hằng tháng',
        queryUnaccented: 'muc dong bao hiem y te hang thang',
        queryVector: [0, 0, 2, 1, 3, 0, 0, 1],
        matchCount: 10,
        corpusVersion: sampleCorpusVersion,
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.chunk.chunkId !== APPENDIX_ID)).toBe(true);
    });

    it('never expands context into a form template', async () => {
      const related = await repo().getRelated([APPENDIX_ID]);
      expect(related).toHaveLength(0);
    });
  });
});

import { describe, expect, it } from 'vitest';

import { reciprocalRankFusion } from '@/features/legal-rag/rank-fusion';

describe('reciprocalRankFusion', () => {
  it('pins exact results before fused results', () => {
    const result = reciprocalRankFusion({
      exact: ['a'],
      keyword: ['b', 'a'],
      vector: ['c', 'b'],
    });
    expect(result[0].id).toBe('a');
  });

  it('fuses ranks so items appearing in multiple lists rank higher', () => {
    const result = reciprocalRankFusion({
      keyword: ['x', 'y', 'z'],
      vector: ['y', 'x', 'w'],
    });
    // y and x appear in both lists; both should precede single-list items.
    expect(result.slice(0, 2).map((entry) => entry.id).sort()).toEqual(['x', 'y']);
  });

  it('keeps exact order and does not double-count a pinned id', () => {
    const result = reciprocalRankFusion({
      exact: ['a', 'b'],
      vector: ['b', 'c'],
    });
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array with no inputs', () => {
    expect(reciprocalRankFusion({})).toEqual([]);
  });
});

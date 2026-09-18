export interface FusedResult {
  id: string;
  score: number;
}

export interface FusionInput {
  /** Exact-reference hits are pinned to the top, in the given order. */
  exact?: readonly string[];
  [listName: string]: readonly string[] | undefined;
}

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion. Any list named `exact` is pinned ahead of the fused
 * ranking so a precise legal-coordinate match never loses to embedding noise.
 */
export function reciprocalRankFusion(input: FusionInput): FusedResult[] {
  const scores = new Map<string, number>();
  for (const [name, list] of Object.entries(input)) {
    if (!list || name === 'exact') continue;
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + index + 1));
    });
  }

  const pinned = input.exact ?? [];
  const pinnedSet = new Set(pinned);

  const fused: FusedResult[] = [...scores.entries()]
    .filter(([id]) => !pinnedSet.has(id))
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  const pinnedResults: FusedResult[] = pinned.map((id, index) => ({
    id,
    score: Number.POSITIVE_INFINITY - index,
  }));

  return [...pinnedResults, ...fused];
}

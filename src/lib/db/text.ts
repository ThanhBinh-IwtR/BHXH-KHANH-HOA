/** Remove Vietnamese diacritics for accent-insensitive matching. */
export function removeAccents(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Deterministic numeric-aware ordering key for a legal coordinate part. */
export function legalSortKey(value: string | null): [number, string] {
  if (value === null) return [Number.POSITIVE_INFINITY, ''];
  const numeric = Number.parseInt(value, 10);
  return [Number.isNaN(numeric) ? Number.POSITIVE_INFINITY : numeric, value];
}

/** Stable comparison over document, article, clause and point coordinates. */
export function compareLegalChunks(
  a: { documentId: string; articleNumber: string | null; clauseNumber: string | null; pointFrom: string | null; chunkId: string },
  b: { documentId: string; articleNumber: string | null; clauseNumber: string | null; pointFrom: string | null; chunkId: string },
): number {
  if (a.documentId !== b.documentId) return a.documentId < b.documentId ? -1 : 1;
  for (const field of ['articleNumber', 'clauseNumber', 'pointFrom'] as const) {
    const [an, as] = legalSortKey(a[field]);
    const [bn, bs] = legalSortKey(b[field]);
    if (an !== bn) return an - bn;
    if (as !== bs) return as < bs ? -1 : 1;
  }
  if (a.chunkId !== b.chunkId) return a.chunkId < b.chunkId ? -1 : 1;
  return 0;
}

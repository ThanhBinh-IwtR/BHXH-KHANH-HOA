export interface LegalReference {
  documentNumber: string;
  article: string;
  clause: string | null;
  point: string | null;
}

const DOC_NUMBER_RE = /(\d{1,3})\s*\/\s*(\d{4})\s*\/\s*N[ĐD]\s*-\s*CP/i;
const ARTICLE_RE = /Đi[eề]u\s+(\d+[A-Za-zĐđ]?)/i;
const CLAUSE_RE = /kho[aả]n\s+(\d+)/i;
const POINT_RE = /đi[eể]m\s+([a-zđ])\b/i;

/** Normalise a Vietnamese decree number to the canonical `158/2025/NĐ-CP` form. */
function normalizeDocumentNumber(raw: string): string {
  const match = DOC_NUMBER_RE.exec(raw);
  if (!match) return raw.trim();
  return `${match[1]}/${match[2]}/NĐ-CP`;
}

/**
 * Parse only EXPLICIT legal coordinates from a query. Returns null when the
 * user did not cite a specific document — natural-language questions must not
 * be forced onto the exact path.
 */
export function parseLegalReference(query: string): LegalReference | null {
  const normalized = query.normalize('NFC');
  const docMatch = DOC_NUMBER_RE.exec(normalized);
  const articleMatch = ARTICLE_RE.exec(normalized);
  if (!docMatch || !articleMatch) return null;

  const clauseMatch = CLAUSE_RE.exec(normalized);
  const pointMatch = POINT_RE.exec(normalized);
  return {
    documentNumber: normalizeDocumentNumber(docMatch[0]),
    article: articleMatch[1],
    clause: clauseMatch ? clauseMatch[1] : null,
    point: pointMatch ? pointMatch[1].toLowerCase() : null,
  };
}

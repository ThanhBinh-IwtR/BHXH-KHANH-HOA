export type ScopeStatus = 'grounded' | 'partial' | 'needs_clarification' | 'out_of_scope';

export interface LegalChunk {
  chunkId: string;
  documentId: string;
  documentNumber: string;
  documentTitle: string;
  contextHeader: string;
  bodyText: string;
  searchText: string;
  searchTextUnaccented: string;
  chapterNumber: string | null;
  sectionNumber: string | null;
  articleNumber: string | null;
  articleTitle: string | null;
  clauseNumber: string | null;
  pointFrom: string | null;
  pointTo: string | null;
  pageFrom: number;
  pageTo: number;
  parentId: string | null;
  previousSiblingId: string | null;
  nextSiblingId: string | null;
  crossReferenceIds: readonly string[];
  tokenCount: number;
  corpusVersion: string;
  /** "normative" rules are retrievable; "appendix" form templates are excluded. */
  chunkType: 'normative' | 'appendix';
  /** Present in the memory store for vector search; null when served from SQL. */
  embedding: readonly number[] | null;
}

export interface SearchQuery {
  queryText: string;
  queryUnaccented: string;
  queryVector: readonly number[] | null;
  matchCount: number;
  corpusVersion: string;
}

export interface RetrievedChunk {
  chunk: LegalChunk;
  exactMatch: boolean;
  keywordRank: number | null;
  vectorRank: number | null;
  fusedScore: number;
  rerankerScore: number | null;
}

export interface VerifiedClaim {
  claim: string;
  sourceIds: readonly string[];
  verdict: 'supported' | 'partially_supported';
}

export interface VerifiedAnswer {
  scopeStatus: ScopeStatus;
  shortAnswer: string;
  shortAnswerSourceIds?: readonly string[];
  analysis: readonly VerifiedClaim[];
  aiSupplement: string | null;
  missingInformation: readonly string[];
  followUpQuestion: string | null;
}

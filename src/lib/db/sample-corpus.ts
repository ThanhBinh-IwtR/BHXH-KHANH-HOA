import type { LegalChunk } from '@/features/legal-rag/types';

import type { LegalDocument } from './legal-repository';
import type { LegalCorpusData } from './memory-legal-repository';
import { removeAccents } from './text';

const CORPUS_VERSION = '2025-demo-v1';

const DOCUMENTS: LegalDocument[] = [
  {
    documentId: 'nd-157-2025',
    documentNumber: '157/2025/NĐ-CP',
    documentType: 'Nghị định',
    title:
      'Quy định chi tiết và biện pháp thi hành một số điều của Luật Bảo hiểm xã hội về bảo hiểm xã hội bắt buộc đối với quân nhân, công an nhân dân',
    issuedDate: '2025-06-25',
    effectiveDate: '2025-07-01',
    corpusVersion: CORPUS_VERSION,
    pdfUrl: '/corpus/157_2025_ND-CP_25062025-signed.pdf',
  },
  {
    documentId: 'nd-158-2025',
    documentNumber: '158/2025/NĐ-CP',
    documentType: 'Nghị định',
    title:
      'Quy định chi tiết và hướng dẫn thi hành một số điều của Luật Bảo hiểm xã hội về bảo hiểm xã hội bắt buộc',
    issuedDate: '2025-06-25',
    effectiveDate: '2025-07-01',
    corpusVersion: CORPUS_VERSION,
    pdfUrl: '/corpus/158_2025_ND-CP_25062025-signed.pdf',
  },
  {
    documentId: 'nd-159-2025',
    documentNumber: '159/2025/NĐ-CP',
    documentType: 'Nghị định',
    title:
      'Quy định chi tiết và hướng dẫn thi hành một số điều của Luật Bảo hiểm xã hội về bảo hiểm xã hội tự nguyện',
    issuedDate: '2025-06-25',
    effectiveDate: '2025-07-01',
    corpusVersion: CORPUS_VERSION,
    pdfUrl: '/corpus/159_2025_ND-CP_25062025-signed.pdf',
  },
  {
    documentId: 'nd-188-2025',
    documentNumber: '188/2025/NĐ-CP',
    documentType: 'Nghị định',
    title: 'Quy định chi tiết và hướng dẫn thi hành một số điều của Luật Bảo hiểm y tế',
    issuedDate: '2025-07-01',
    effectiveDate: '2025-08-15',
    corpusVersion: CORPUS_VERSION,
    pdfUrl: '/corpus/188_2025_ND-CP_01072025-signed.pdf',
  },
];

interface ChunkSeed {
  documentId: string;
  documentNumber: string;
  documentTitle: string;
  chapterNumber?: string | null;
  articleNumber: string;
  articleTitle: string;
  clauseNumber?: string | null;
  pointFrom?: string | null;
  pointTo?: string | null;
  bodyText: string;
  pageFrom: number;
  pageTo: number;
  parentId?: string | null;
  chunkType?: 'normative' | 'appendix';
  chunkId?: string;
  embedding: number[];
}

/** Small hand-tuned embeddings keep vector search deterministic in tests. */
function embed(seed: number[]): number[] {
  const vector = new Array<number>(8).fill(0);
  seed.forEach((value, index) => {
    vector[index % 8] += value;
  });
  return vector;
}

function buildChunk(seed: ChunkSeed): LegalChunk {
  const clause = seed.clauseNumber ?? null;
  const pointFrom = seed.pointFrom ?? null;
  const pointTo = seed.pointTo ?? pointFrom;
  const headerParts = [seed.documentNumber];
  if (seed.chapterNumber) headerParts.push(`Chương ${seed.chapterNumber}`);
  headerParts.push(`Điều ${seed.articleNumber}. ${seed.articleTitle}`);
  if (clause) headerParts.push(`Khoản ${clause}`);
  if (pointFrom) headerParts.push(`Điểm ${pointFrom}${pointTo && pointTo !== pointFrom ? `-${pointTo}` : ''}`);
  const contextHeader = headerParts.join(' > ');
  const searchText = `${contextHeader}\n${seed.bodyText}`;
  const coordinate = [seed.documentId, `dieu-${seed.articleNumber}`];
  if (clause) coordinate.push(`khoan-${clause}`);
  if (pointFrom) coordinate.push(`diem-${pointFrom}-${pointTo}`);
  coordinate.push(CORPUS_VERSION);
  return {
    chunkId: seed.chunkId ?? coordinate.join(':'),
    documentId: seed.documentId,
    documentNumber: seed.documentNumber,
    documentTitle: seed.documentTitle,
    contextHeader,
    bodyText: seed.bodyText,
    searchText,
    searchTextUnaccented: removeAccents(searchText),
    chapterNumber: seed.chapterNumber ?? null,
    sectionNumber: null,
    articleNumber: seed.articleNumber,
    articleTitle: seed.articleTitle,
    clauseNumber: clause,
    pointFrom,
    pointTo,
    pageFrom: seed.pageFrom,
    pageTo: seed.pageTo,
    parentId: seed.parentId ?? null,
    previousSiblingId: null,
    nextSiblingId: null,
    crossReferenceIds: [],
    tokenCount: Math.max(1, seed.bodyText.split(/\s+/).length),
    corpusVersion: CORPUS_VERSION,
    chunkType: seed.chunkType ?? 'normative',
    embedding: embed(seed.embedding),
  };
}

const SEEDS: ChunkSeed[] = [
  {
    documentId: 'nd-158-2025',
    documentNumber: '158/2025/NĐ-CP',
    documentTitle: DOCUMENTS[1].title,
    chapterNumber: 'II',
    articleNumber: '12',
    articleTitle: 'Mức đóng và phương thức đóng bảo hiểm xã hội bắt buộc',
    clauseNumber: '3',
    bodyText:
      'Người sử dụng lao động hằng tháng đóng trên quỹ tiền lương làm căn cứ đóng bảo hiểm xã hội bắt buộc của người lao động với tỷ lệ 17% vào quỹ hưu trí và tử tuất.',
    pageFrom: 8,
    pageTo: 8,
    parentId: 'nd-158-2025:dieu-12:2025-demo-v1',
    embedding: [3, 1, 0, 2, 0, 0, 1, 0],
  },
  {
    documentId: 'nd-158-2025',
    documentNumber: '158/2025/NĐ-CP',
    documentTitle: DOCUMENTS[1].title,
    chapterNumber: 'II',
    articleNumber: '12',
    articleTitle: 'Mức đóng và phương thức đóng bảo hiểm xã hội bắt buộc',
    clauseNumber: '1',
    bodyText:
      'Người lao động hằng tháng đóng bằng 8% mức tiền lương làm căn cứ đóng bảo hiểm xã hội bắt buộc vào quỹ hưu trí và tử tuất.',
    pageFrom: 8,
    pageTo: 8,
    parentId: 'nd-158-2025:dieu-12:2025-demo-v1',
    embedding: [2, 2, 0, 1, 0, 0, 1, 0],
  },
  {
    documentId: 'nd-158-2025',
    documentNumber: '158/2025/NĐ-CP',
    documentTitle: DOCUMENTS[1].title,
    chapterNumber: 'I',
    articleNumber: '2',
    articleTitle: 'Đối tượng áp dụng',
    clauseNumber: '1',
    bodyText:
      'Người lao động là công dân Việt Nam thuộc đối tượng tham gia bảo hiểm xã hội bắt buộc theo quy định của Luật Bảo hiểm xã hội.',
    pageFrom: 2,
    pageTo: 2,
    parentId: 'nd-158-2025:dieu-2:2025-demo-v1',
    embedding: [1, 0, 3, 0, 1, 0, 0, 0],
  },
  {
    documentId: 'nd-159-2025',
    documentNumber: '159/2025/NĐ-CP',
    documentTitle: DOCUMENTS[2].title,
    chapterNumber: 'II',
    articleNumber: '5',
    articleTitle: 'Mức đóng bảo hiểm xã hội tự nguyện',
    clauseNumber: '1',
    bodyText:
      'Người tham gia bảo hiểm xã hội tự nguyện hằng tháng đóng bằng 22% mức thu nhập làm căn cứ đóng bảo hiểm xã hội tự nguyện vào quỹ hưu trí và tử tuất.',
    pageFrom: 4,
    pageTo: 4,
    parentId: 'nd-159-2025:dieu-5:2025-demo-v1',
    embedding: [0, 3, 1, 0, 0, 2, 0, 1],
  },
  {
    documentId: 'nd-188-2025',
    documentNumber: '188/2025/NĐ-CP',
    documentTitle: DOCUMENTS[3].title,
    chapterNumber: 'II',
    articleNumber: '7',
    articleTitle: 'Mức đóng bảo hiểm y tế',
    clauseNumber: '1',
    bodyText:
      'Mức đóng bảo hiểm y tế hằng tháng của đối tượng tham gia bằng 4,5% mức tiền lương làm căn cứ đóng bảo hiểm y tế.',
    pageFrom: 5,
    pageTo: 5,
    parentId: 'nd-188-2025:dieu-7:2025-demo-v1',
    embedding: [0, 0, 2, 1, 3, 0, 0, 1],
  },
  {
    documentId: 'nd-157-2025',
    documentNumber: '157/2025/NĐ-CP',
    documentTitle: DOCUMENTS[0].title,
    chapterNumber: 'I',
    articleNumber: '1',
    articleTitle: 'Phạm vi điều chỉnh',
    bodyText:
      'Nghị định này quy định chi tiết và biện pháp thi hành một số điều của Luật Bảo hiểm xã hội về bảo hiểm xã hội bắt buộc đối với quân nhân, công an nhân dân, dân quân thường trực.',
    pageFrom: 1,
    pageTo: 1,
    embedding: [1, 1, 1, 1, 0, 0, 0, 0],
  },
  {
    // Appendix/form template. It deliberately shares vocabulary with real
    // questions ("mức đóng bảo hiểm y tế") to prove it is never retrieved.
    documentId: 'nd-188-2025',
    documentNumber: '188/2025/NĐ-CP',
    documentTitle: DOCUMENTS[3].title,
    chunkId: 'nd-188-2025:phu-luc-1:mau-6:noi-dung:2025-demo-v1',
    articleNumber: '__form__',
    articleTitle: 'Mẫu số 6 — Biên bản thanh lý hợp đồng khám bệnh, chữa bệnh bảo hiểm y tế',
    bodyText:
      'Mẫu số 6. Biên bản thanh lý hợp đồng khám bệnh, chữa bệnh bảo hiểm y tế. Mức đóng bảo hiểm y tế: ……… Ngày …… tháng …… năm ……',
    pageFrom: 95,
    pageTo: 95,
    chunkType: 'appendix',
    embedding: [0, 0, 2, 1, 3, 0, 0, 1],
  },
];

export const sampleCorpus: LegalCorpusData = {
  documents: DOCUMENTS,
  chunks: SEEDS.map(buildChunk),
};

export const sampleCorpusVersion = CORPUS_VERSION;

import type { BuiltContext } from './context-builder';

export interface AnswerClaimLike {
  claim: string;
  source_ids: readonly string[];
}

export interface AnswerLike {
  scope_status: string;
  short_answer?: string;
  analysis: readonly AnswerClaimLike[];
}

export interface DeterministicIssue {
  code:
    | 'UNKNOWN_SOURCE_ID'
    | 'MISSING_SOURCE'
    | 'QUOTE_MISMATCH'
    | 'NUMERIC_MISMATCH'
    | 'DATE_MISMATCH'
    | 'REFERENCE_MISMATCH'
    | 'SHORT_ANSWER_MISMATCH'
    | 'INVALID_SHORT_ANSWER';
  message: string;
  claimIndex: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: DeterministicIssue[];
}

const NUMERIC_CLAIM_RE = /\d|phần\s*trăm|%/i;
const NUMERIC_FACT_RE = /(\d+(?:[.,]\d+)?)\s*(%|phần\s*trăm|ngày|tháng|năm|tuổi|đồng|triệu|tỷ)/gi;
const DATE_FACT_RE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b|\bnăm\s+\d{4}\b/gi;
const DOCUMENT_REFERENCE_RE = /\b\d{1,3}\s*\/\s*\d{4}\s*\/\s*n[đd]\s*-\s*cp\b/gi;
const ARTICLE_REFERENCE_RE = /điều\s+(\d+[a-zđ]?)\b/gi;
const CLAUSE_REFERENCE_RE = /\bkhoản\s+(\d+)\b/gi;
const POINT_REFERENCE_RE = /điểm\s+([a-zđ])\b/gi;
const QUOTE_RE = /[“"]([^”"]{4,})[”"]/g;
const IMPORTANT_PARTICIPANT_GROUPS: readonly (readonly string[])[] = [
  ['người lao động'],
  ['người sử dụng lao động'],
  ['người tham gia bảo hiểm xã hội bắt buộc', 'người tham gia bhxh bắt buộc'],
  ['người tham gia bảo hiểm xã hội tự nguyện', 'người tham gia bhxh tự nguyện'],
  ['đối tượng tham gia bảo hiểm y tế', 'đối tượng tham gia bhyt'],
  ['hộ gia đình'],
  ['học sinh'],
  ['sinh viên'],
  ['trẻ em dưới 6 tuổi'],
];

function normalize(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function numericFacts(text: string): string[] {
  return [...text.matchAll(NUMERIC_FACT_RE)].map((match) => {
    const number = match[1].replace(',', '.');
    const rawUnit = match[2].toLocaleLowerCase('vi');
    const unit = rawUnit === '%' || rawUnit.includes('phần') ? '%' : rawUnit;
    return `${number}:${unit}`;
  });
}

function dateFacts(text: string): string[] {
  return [...text.matchAll(DATE_FACT_RE)].map((match) => normalize(match[0]));
}

function hasAllFacts(text: string, sources: readonly string[]): boolean {
  const facts = numericFacts(text);
  if (facts.length === 0) return true;
  const sourceFacts = new Set(sources.flatMap(numericFacts));
  return facts.every((fact) => sourceFacts.has(fact));
}

function hasSupportedDates(text: string, sources: readonly string[]): boolean {
  const facts = dateFacts(text);
  if (facts.length === 0) return true;
  const sourceFacts = new Set(sources.flatMap(dateFacts));
  return facts.every((fact) => sourceFacts.has(fact));
}

function hasSupportedParticipants(text: string, sources: readonly string[]): boolean {
  const normalizedText = normalize(text);
  const normalizedSources = normalize(sources.join(' '));
  return IMPORTANT_PARTICIPANT_GROUPS.filter((group) =>
    group.some((term) => normalizedText.includes(term)),
  ).every((group) => group.some((term) => normalizedSources.includes(term)));
}

function referencesSupported(text: string, labels: readonly string[]): boolean {
  const normalized = normalize(text);
  const normalizedLabels = labels.map((label) => normalize(label));
  const documents = [...normalized.matchAll(DOCUMENT_REFERENCE_RE)].map((match) =>
    match[0].replace(/\s+/g, ''),
  );
  const articles = [...normalized.matchAll(ARTICLE_REFERENCE_RE)].map((match) => match[1]);
  const clauses = [...normalized.matchAll(CLAUSE_REFERENCE_RE)].map((match) => match[1]);
  const points = [...normalized.matchAll(POINT_REFERENCE_RE)].map((match) => match[1]);
  if (
    documents.some((document) =>
      !normalizedLabels.some((label) => label.replace(/\s+/g, '').includes(document)),
    )
  ) {
    return false;
  }
  if (articles.length === 0 && clauses.length === 0 && points.length === 0) return true;
  const labelHas = (label: string, kind: 'điều' | 'khoản' | 'điểm', value: string) =>
    label.includes(kind + ' ' + value);
  const articleMatches = articles.every((article) =>
    normalizedLabels.some(
      (label) =>
        labelHas(label, 'điều', article) &&
        (clauses.length === 0 ||
          clauses.some((clause) => labelHas(label, 'khoản', clause))) &&
        (points.length === 0 || points.some((point) => labelHas(label, 'điểm', point))),
    ),
  );
  const clauseMatches = clauses.every((clause) =>
    normalizedLabels.some(
      (label) =>
        labelHas(label, 'khoản', clause) &&
        (articles.length === 0 ||
          articles.some((article) => labelHas(label, 'điều', article))) &&
        (points.length === 0 || points.some((point) => labelHas(label, 'điểm', point))),
    ),
  );
  const pointMatches = points.every((point) =>
    normalizedLabels.some(
      (label) =>
        labelHas(label, 'điểm', point) &&
        (articles.length === 0 ||
          articles.some((article) => labelHas(label, 'điều', article))) &&
        (clauses.length === 0 ||
          clauses.some((clause) => labelHas(label, 'khoản', clause))),
    ),
  );
  return articleMatches && clauseMatches && pointMatches;
}

/**
 * Deterministic, model-free validation run BEFORE any answer is shown.
 * Enforces citation integrity so the model can never invent legal authority.
 */
export function validateAnswer(answer: AnswerLike, context: BuiltContext): ValidationResult {
  const known = new Set(context.sourceIds);
  const bodyById = new Map(
    context.sources.map((source) => [source.chunkId, normalize(source.bodyText)]),
  );
  const issues: DeterministicIssue[] = [];

  if (answer.short_answer !== undefined && !answer.short_answer.trim()) {
    issues.push({
      code: 'INVALID_SHORT_ANSWER',
      message: 'Kết luận ngắn không được để trống',
      claimIndex: -1,
    });
  }

  answer.analysis.forEach((claim, claimIndex) => {
    for (const sourceId of claim.source_ids) {
      if (!known.has(sourceId)) {
        issues.push({
          code: 'UNKNOWN_SOURCE_ID',
          message: `Nguồn "${sourceId}" không nằm trong ngữ cảnh đã cung cấp`,
          claimIndex,
        });
      }
    }

    const isNumeric = NUMERIC_CLAIM_RE.test(claim.claim);
    if (claim.source_ids.length === 0 && (isNumeric || claim.claim.length > 0)) {
      issues.push({
        code: 'MISSING_SOURCE',
        message: 'Mệnh đề pháp lý phải có ít nhất một nguồn',
        claimIndex,
      });
    }

    const citedBodies = claim.source_ids
      .map((id) => bodyById.get(id))
      .filter((body): body is string => body !== undefined);
    const citedLabels = claim.source_ids
      .map((id) => context.sources.find((source) => source.chunkId === id)?.label)
      .filter((label): label is string => label !== undefined);
    if (!hasAllFacts(claim.claim, citedBodies)) {
      issues.push({
        code: 'NUMERIC_MISMATCH',
        message: 'Số liệu trong mệnh đề không xuất hiện trong các nguồn được trích dẫn',
        claimIndex,
      });
    }
    if (!hasSupportedDates(claim.claim, citedBodies)) {
      issues.push({
        code: 'DATE_MISMATCH',
        message: 'Ngày hoặc năm trong mệnh đề không xuất hiện trong các nguồn được trích dẫn',
        claimIndex,
      });
    }
    if (
      !referencesSupported(claim.claim, citedLabels) ||
      !hasSupportedParticipants(claim.claim, citedBodies)
    ) {
      issues.push({
        code: 'REFERENCE_MISMATCH',
        message: 'Điều, Khoản, Điểm, số hiệu hoặc nhóm đối tượng trong mệnh đề không khớp nguồn được trích dẫn',
        claimIndex,
      });
    }
    for (const match of claim.claim.matchAll(QUOTE_RE)) {
      const quoted = normalize(match[1]);
      if (!citedBodies.some((body) => body.includes(quoted))) {
        issues.push({
          code: 'QUOTE_MISMATCH',
          message: `Trích dẫn nguyên văn không khớp nguồn: "${match[1]}"`,
          claimIndex,
        });
      }
    }
  });

  if (answer.short_answer?.trim()) {
    const citedBodies = [...new Set(answer.analysis.flatMap((claim) => claim.source_ids))]
      .map((id) => bodyById.get(id))
      .filter((body): body is string => body !== undefined);
    const citedLabels = [
      ...new Set(answer.analysis.flatMap((claim) => claim.source_ids)),
    ]
      .map((id) => context.sources.find((source) => source.chunkId === id)?.label)
      .filter((label): label is string => label !== undefined);
    if (
      !hasAllFacts(answer.short_answer, citedBodies) ||
      !hasSupportedDates(answer.short_answer, citedBodies) ||
      !referencesSupported(answer.short_answer, citedLabels) ||
      !hasSupportedParticipants(answer.short_answer, citedBodies)
    ) {
      issues.push({
        code: 'SHORT_ANSWER_MISMATCH',
        message: 'Số liệu trong kết luận ngắn không xuất hiện trong nguồn của các mệnh đề',
        claimIndex: -1,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

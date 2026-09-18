import type { ModelAnswer } from './answer-schema';
import type { BuiltContext, ContextSource } from './context-builder';

const MIN_GROUNDED_ANALYSIS = 3;
const MAX_GROUNDED_ANALYSIS = 5;
const RATE_RE = /(\d+(?:[.,]\d+)?)\s*(%|phần\s*trăm)/i;

interface RateRule {
  source: ContextSource;
  rate: string;
  basis: string;
}

/**
 * Keep a grounded/partial answer useful when a compatible model satisfies the
 * JSON shape but ignores the requested analysis depth. Only formula explanations
 * that can be derived from the cited source are added; this never calls an
 * LLM and never introduces a new legal rate, date, group, or entitlement.
 */
export function ensureGroundedAnswerDepth(
  answer: ModelAnswer,
  context: BuiltContext,
  question = '',
): ModelAnswer {
  if (answer.scope_status !== 'grounded' && answer.scope_status !== 'partial') return answer;

  const rule = findRelevantRateRule(context.sources, question);
  if (!rule) return answer;

  const analysis = pruneRestatements(answer.analysis, answer.short_answer);
  const addClaim = (claim: string): void => {
    if (analysis.length >= MAX_GROUNDED_ANALYSIS) return;
    const normalized = normalize(claim);
    if (analysis.some((item) => normalize(item.claim) === normalized)) return;
    analysis.push({ claim, source_ids: [rule.source.chunkId] });
  };

  const hasPracticalDepth = analysis.some((claim) =>
    /công thức|cách (?:tính|áp dụng)|phụ thuộc|quy đổi|không phải.*số tiền|đối chiếu.*trường hợp/i.test(
      claim.claim,
    ),
  );
  if (analysis.length < MIN_GROUNDED_ANALYSIS || !hasPracticalDepth) {
    addClaim(
      `Về cách hiểu, tỷ lệ ${rule.rate} được áp dụng trên ${rule.basis}; đây là tỷ lệ dùng để tính mức đóng chứ không phải một số tiền cố định.`,
    );
    addClaim(
      `Công thức có thể trình bày lại từ căn cứ này là: mức đóng hằng tháng = ${rule.basis} × ${rule.rate}. Muốn quy đổi ra số tiền cụ thể, cần có ${rule.basis} của trường hợp đang xét.`,
    );
    addClaim(
      `Đoạn căn cứ đã xác định tỷ lệ và căn cứ tính cho đối tượng tham gia, nhưng chưa nêu một mức tiền cụ thể cho từng trường hợp. Vì vậy, khi áp dụng thực tế cần đối chiếu đúng mức căn cứ của người đang được xem xét.`,
    );
  }

  const shortAnswer = ensureConclusionDepth(answer.short_answer, rule);
  return { ...answer, short_answer: shortAnswer, analysis };
}

function findRelevantRateRule(
  sources: readonly ContextSource[],
  question: string,
): RateRule | null {
  const rules = sources
    .map(extractRateRule)
    .filter((value): value is RateRule => value !== null);
  if (rules.length === 0) return null;

  const relevant = rules.filter((rule) => matchesQuestionTopic(rule.source, question));
  if (relevant.length === 1) return relevant[0];
  if (relevant.length === 0) return rules.length === 1 ? rules[0] : null;

  const ranked = relevant
    .map((rule) => ({ rule, score: questionTopicScore(rule.source, question) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0].score > (ranked[1]?.score ?? -Infinity) ? ranked[0].rule : null;
}

function matchesQuestionTopic(source: ContextSource, question: string): boolean {
  const normalizedQuestion = normalize(question);
  const sourceText = normalize(`${source.documentNumber} ${source.label} ${source.bodyText}`);
  const document = /\b(\d{1,3})\s*\/\s*(\d{4})\s*\/\s*n[đd]\s*-\s*cp\b/i.exec(question);
  if (document && normalizeDocumentNumber(source.documentNumber) !== normalizeDocumentNumber(document[0])) {
    return false;
  }

  if (hasAny(normalizedQuestion, ['bhyt', 'bảo hiểm y tế']) && !sourceText.includes('bảo hiểm y tế')) {
    return false;
  }
  if (hasAny(normalizedQuestion, ['bhxh', 'bảo hiểm xã hội']) && !sourceText.includes('bảo hiểm xã hội')) {
    return false;
  }

  for (const qualifier of ['tự nguyện', 'bắt buộc', 'người sử dụng lao động', 'người lao động']) {
    if (normalizedQuestion.includes(qualifier) && !sourceText.includes(qualifier)) return false;
  }
  return true;
}

function questionTopicScore(source: ContextSource, question: string): number {
  const normalizedQuestion = normalize(question);
  const sourceText = normalize(`${source.documentNumber} ${source.label} ${source.bodyText}`);
  let score = 0;
  for (const phrase of ['bhyt', 'bảo hiểm y tế', 'bhxh', 'bảo hiểm xã hội']) {
    if (normalizedQuestion.includes(phrase) && sourceText.includes(phrase)) score += 5;
  }
  for (const phrase of ['tự nguyện', 'bắt buộc', 'người sử dụng lao động', 'người lao động']) {
    if (normalizedQuestion.includes(phrase) && sourceText.includes(phrase)) score += 3;
  }
  if (normalizeDocumentNumber(source.documentNumber) === normalizeDocumentNumber(question)) score += 5;
  return score;
}

function extractRateRule(source: ContextSource): RateRule | null {
  const body = source.bodyText.replace(/\s+/g, ' ').trim();
  const rateMatch = RATE_RE.exec(body);
  if (!rateMatch || rateMatch.index === undefined) return null;

  const beforeRate = body.slice(0, rateMatch.index);
  const afterRate = body.slice(rateMatch.index + rateMatch[0].length).replace(/^[\s:,-]+/, '');
  const basisBeforeRate = /\btrên\s+(.+?)\s+(?:với\s+)?tỷ\s+lệ\s*$/i.exec(beforeRate);
  const basisAfterRate = /^(.+?)(?:[.!?]|$)/.exec(afterRate);
  const basis = (basisBeforeRate?.[1] ?? basisAfterRate?.[1] ?? '').trim();
  if (!basis || basis.length < 4) return null;

  return { source, rate: rateMatch[0].replace(/\s+/g, ''), basis };
}

function ensureConclusionDepth(shortAnswer: string, rule: RateRule): string {
  const trimmed = shortAnswer.trim();
  if (sentenceCount(trimmed) >= 2 || /số tiền cụ thể|không phải.*số tiền/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed} Tỷ lệ này được áp dụng trên ${rule.basis}, nên số tiền thực tế phụ thuộc vào mức căn cứ của trường hợp cụ thể.`;
}

function pruneRestatements(
  claims: readonly ModelAnswer['analysis'][number][],
  shortAnswer: string,
): ModelAnswer['analysis'][number][] {
  const unique: ModelAnswer['analysis'][number][] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    const normalized = normalize(claim.claim);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(claim);
  }

  const shortWords = words(shortAnswer);
  const useful = unique.filter((claim) => {
    if (
      /(?:được|đã)\s+(?:quy định|nêu)\s+tại\s+(?:điều|khoản|điểm)/i.test(claim.claim) &&
      !RATE_RE.test(claim.claim)
    ) {
      return false;
    }
    const claimWords = words(claim.claim);
    if (claimWords.size < 4 || claimWords.size > shortWords.size) return true;
    const overlap = [...claimWords].filter((word) => shortWords.has(word)).length;
    return overlap / claimWords.size < 0.9;
  });
  return useful;
}

function sentenceCount(text: string): number {
  return text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
}

function normalize(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi');
}

function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function normalizeDocumentNumber(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/\s+/g, '')
    .replace(/đ/g, 'd');
}

function words(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/\s+/)
      .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((word) => word.length >= 3),
  );
}

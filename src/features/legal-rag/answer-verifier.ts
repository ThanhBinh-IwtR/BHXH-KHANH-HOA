import type { ModelAnswer } from './answer-schema';
import { validateAnswer } from './answer-validator';
import type { BuiltContext } from './context-builder';
import type { ScopeStatus, VerifiedAnswer, VerifiedClaim } from './types';

const CORPUS_BOUNDARY_VI =
  'bốn nghị định: 157/2025/NĐ-CP, 158/2025/NĐ-CP, 159/2025/NĐ-CP và 188/2025/NĐ-CP';

export const SAFE_FALLBACK: VerifiedAnswer = {
  scopeStatus: 'out_of_scope',
  shortAnswer:
    `Nội dung bạn hỏi cần được đối chiếu từ nguồn chính thức. Hệ thống hiện chưa có căn cứ đã xác thực trong ${CORPUS_BOUNDARY_VI}, vì vậy không thể đưa ra một kết luận pháp lý chính xác.`,
  shortAnswerSourceIds: [],
  analysis: [],
  aiSupplement: null,
  missingInformation: ['Văn bản chính thức điều chỉnh nội dung bạn hỏi'],
  followUpQuestion:
    'Bạn có thể bổ sung số hiệu Điều/Khoản, đối chiếu văn bản chính thức hoặc liên hệ BHXH tỉnh Khánh Hòa.',
};

/**
 * Model-free verification. Claims are retained only when their source IDs,
 * citations, quotes and sensitive numeric facts pass deterministic validation.
 * This function intentionally performs no provider call.
 */
export function verifyAnswer(
  answer: ModelAnswer,
  context: BuiltContext,
): VerifiedAnswer {
  const validation = validateAnswer(answer, context);
  const invalidClaimIndexes = new Set(
    validation.issues
      .filter((issue) => issue.claimIndex >= 0)
      .map((issue) => issue.claimIndex),
  );
  const shortAnswerInvalid = validation.issues.some(
    (issue) => issue.code === 'INVALID_SHORT_ANSWER' || issue.code === 'SHORT_ANSWER_MISMATCH',
  );
  const known = new Set(context.sourceIds);
  const supported: VerifiedClaim[] = answer.analysis
    .filter((_claim, index) => !invalidClaimIndexes.has(index))
    .map((claim) => ({
      claim: claim.claim,
      sourceIds: [...new Set(claim.source_ids)].filter((id) => known.has(id)),
      verdict: 'supported' as const,
    }))
    .filter((claim) => claim.sourceIds.length > 0);

  if (
    (answer.scope_status === 'grounded' || answer.scope_status === 'partial') &&
    supported.length === 0
  ) {
    return SAFE_FALLBACK;
  }

  if (answer.scope_status === 'out_of_scope') {
    return SAFE_FALLBACK;
  }

  const downgraded = invalidClaimIndexes.size > 0 || shortAnswerInvalid;
  const scopeStatus: ScopeStatus =
    answer.scope_status === 'grounded' && downgraded ? 'partial' : answer.scope_status;
  const sourceIds = [...new Set(supported.flatMap((claim) => claim.sourceIds))];
  const shortAnswer = shortAnswerInvalid
    ? 'Các nguồn hiện có chưa đủ căn cứ để xác nhận toàn bộ kết luận ngắn gọn; phần có căn cứ được nêu bên dưới.'
    : answer.short_answer;

  return completeScopeGuidance({
    scopeStatus,
    shortAnswer,
    shortAnswerSourceIds: shortAnswerInvalid ? [] : sourceIds,
    analysis: supported,
    // A supplement has no claim-level citation contract. Keep the public
    // response grounded without reintroducing a second semantic verifier.
    aiSupplement: null,
    missingInformation:
      shortAnswerInvalid && answer.missing_information.length === 0
        ? ['Kết luận ngắn cần được đối chiếu thêm với văn bản nguồn']
        : answer.missing_information,
    followUpQuestion: answer.follow_up_question,
  });
}

function completeScopeGuidance(answer: VerifiedAnswer): VerifiedAnswer {
  if (answer.scopeStatus === 'grounded') return answer;

  if (answer.scopeStatus === 'partial') {
    const shortAnswer = /chỉ hỗ trợ một phần|chỉ xác nhận một phần/i.test(answer.shortAnswer)
      ? answer.shortAnswer
      : `${answer.shortAnswer.trim()} Nguồn hiện có chỉ hỗ trợ một phần; phần còn lại cần được đối chiếu với văn bản chính thức.`;
    return {
      ...answer,
      shortAnswer,
      missingInformation:
        answer.missingInformation.length > 0
          ? answer.missingInformation
          : ['Phần thông tin còn lại chưa có căn cứ trong ngữ cảnh hiện tại'],
      followUpQuestion:
        answer.followUpQuestion ??
        'Bạn có thể bổ sung dữ kiện hoặc đối chiếu phần còn lại với văn bản chính thức.',
      aiSupplement: null,
    };
  }

  if (answer.scopeStatus === 'needs_clarification') {
    return {
      ...answer,
      shortAnswer: answer.shortAnswer.trim() || 'Cần thêm thông tin để trả lời chính xác.',
      missingInformation:
        answer.missingInformation.length > 0
          ? answer.missingInformation
          : ['Loại bảo hiểm, nhóm đối tượng hoặc hoàn cảnh áp dụng'],
      followUpQuestion:
        answer.followUpQuestion ??
        'Bạn đang hỏi về loại bảo hiểm hoặc nhóm đối tượng nào?',
      aiSupplement: null,
    };
  }

  return {
    ...SAFE_FALLBACK,
    shortAnswerSourceIds: [],
  };
}

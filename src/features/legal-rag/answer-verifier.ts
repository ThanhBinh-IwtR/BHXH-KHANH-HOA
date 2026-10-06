import { ensureGroundedAnswerDepth } from './answer-depth';
import type { ModelAnswer } from './answer-schema';
import { validateAnswer, type ValidationResult } from './answer-validator';
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
  missingInformation: ['Văn bản chính thức điều chỉnh nội dung bạn hỏi'],
  followUpQuestion:
    'Bạn có thể bổ sung số hiệu Điều/Khoản, đối chiếu văn bản chính thức hoặc liên hệ BHXH tỉnh Khánh Hòa.',
};

export interface VerificationReport {
  answer: VerifiedAnswer;
  /** Model claims removed by deterministic validation (system-added depth claims excluded). */
  rejectedClaimCount: number;
  /** Non-sensitive reasons for rejections, downgrades and fallbacks. */
  reasons: readonly string[];
}

/** Model-free verification; see {@link verifyAnswerWithReport}. */
export function verifyAnswer(
  answer: ModelAnswer,
  context: BuiltContext,
  question = '',
): VerifiedAnswer {
  return verifyAnswerWithReport(answer, context, question).answer;
}

/**
 * Model-free verification, performed once per generated answer:
 *   1. validate the model output and drop every rejected claim;
 *   2. restore source-backed depth on the surviving claims (no model call);
 *   3. re-validate only when the shape changed, i.e. the answer actually shown;
 *   4. downgrade grounded to partial whenever a model claim or the short answer
 *      was rejected, so the badge never claims more than was verified.
 */
export function verifyAnswerWithReport(
  answer: ModelAnswer,
  context: BuiltContext,
  question = '',
): VerificationReport {
  if (answer.scope_status === 'out_of_scope') {
    return { answer: SAFE_FALLBACK, rejectedClaimCount: 0, reasons: ['model_out_of_scope'] };
  }

  const first = validateAnswer(answer, context);
  const rejected = invalidClaimIndexes(first);
  const reasons = issueReasons(first);
  const fallback = (reason: string): VerificationReport => ({
    answer: SAFE_FALLBACK,
    rejectedClaimCount: rejected.size,
    reasons: [...reasons, reason],
  });

  if (hasIssue(first, 'INVALID_SHORT_ANSWER')) return fallback('invalid_short_answer');
  const survivors = answer.analysis.filter((_claim, index) => !rejected.has(index));
  if (requiresClaims(answer.scope_status) && survivors.length === 0) {
    return fallback('no_supported_claims');
  }

  const filtered = rejected.size > 0 ? { ...answer, analysis: survivors } : answer;
  let shown = ensureGroundedAnswerDepth(filtered, context, question);
  let validation = first;
  if (shown !== answer) {
    validation = validateAnswer(shown, context);
    // Surviving model claims already passed their per-claim checks, so only a
    // system-added depth claim can be rejected here. It is dropped, not counted.
    const rejectedDepth = invalidClaimIndexes(validation);
    if (rejectedDepth.size > 0) {
      reasons.push('depth_claim_rejected');
      shown = {
        ...shown,
        analysis: shown.analysis.filter((_claim, index) => !rejectedDepth.has(index)),
      };
      validation = validateAnswer(shown, context);
    }
  }
  if (hasIssue(validation, 'INVALID_SHORT_ANSWER')) return fallback('invalid_short_answer');

  const known = new Set(context.sourceIds);
  const supported: VerifiedClaim[] = shown.analysis
    .map((claim) => ({
      claim: claim.claim,
      sourceIds: [...new Set(claim.source_ids)].filter((id) => known.has(id)),
      verdict: 'supported' as const,
    }))
    .filter((claim) => claim.sourceIds.length > 0);
  if (requiresClaims(shown.scope_status) && supported.length === 0) {
    return fallback('no_supported_claims');
  }

  const shortAnswerInvalid = hasIssue(validation, 'SHORT_ANSWER_MISMATCH');
  if (shortAnswerInvalid) reasons.push('validator_short_answer_mismatch', 'short_answer_replaced');
  const downgraded = rejected.size > 0 || shortAnswerInvalid;
  const scopeStatus: ScopeStatus =
    shown.scope_status === 'grounded' && downgraded ? 'partial' : shown.scope_status;
  if (scopeStatus !== shown.scope_status) reasons.push('grounded_downgraded_to_partial');

  const sourceIds = [...new Set(supported.flatMap((claim) => claim.sourceIds))];
  const shortAnswer = shortAnswerInvalid
    ? 'Các nguồn hiện có chưa đủ căn cứ để xác nhận toàn bộ kết luận ngắn gọn; phần có căn cứ được nêu bên dưới.'
    : shown.short_answer;

  return {
    answer: completeScopeGuidance({
      scopeStatus,
      shortAnswer,
      shortAnswerSourceIds: shortAnswerInvalid ? [] : sourceIds,
      analysis: supported,
      missingInformation:
        shortAnswerInvalid && shown.missing_information.length === 0
          ? ['Kết luận ngắn cần được đối chiếu thêm với văn bản nguồn']
          : shown.missing_information,
      followUpQuestion: shown.follow_up_question,
    }),
    rejectedClaimCount: rejected.size,
    reasons,
  };
}

function requiresClaims(scopeStatus: ScopeStatus): boolean {
  return scopeStatus === 'grounded' || scopeStatus === 'partial';
}

function invalidClaimIndexes(validation: ValidationResult): Set<number> {
  return new Set(
    validation.issues
      .filter((issue) => issue.claimIndex >= 0)
      .map((issue) => issue.claimIndex),
  );
}

function hasIssue(validation: ValidationResult, code: ValidationResult['issues'][number]['code']) {
  return validation.issues.some((issue) => issue.code === code);
}

function issueReasons(validation: ValidationResult): string[] {
  return [
    ...new Set(
      validation.issues
        .filter((issue) => issue.claimIndex >= 0)
        .map((issue) => `validator_${issue.code.toLowerCase()}`),
    ),
  ];
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
    };
  }

  return {
    ...SAFE_FALLBACK,
    shortAnswerSourceIds: [],
  };
}

import { describe, expect, it } from 'vitest';

import { answerSchema, type ModelAnswer } from '@/features/legal-rag/answer-schema';
import type { BuiltContext } from '@/features/legal-rag/context-builder';
import {
  SAFE_FALLBACK,
  verifyAnswer,
  verifyAnswerWithReport,
} from '@/features/legal-rag/answer-verifier';

function context(ids: string[]): BuiltContext {
  return {
    sources: ids.map((id) => ({
      chunkId: id,
      documentNumber: '158/2025/NĐ-CP',
      label: id,
      bodyText: id === 'a' ? 'Mệnh đề đúng, mức đóng là 17%.' : 'Nội dung khác.',
      pageFrom: 1,
      pageTo: 1,
    })),
    sourceIds: ids,
    contextText: '',
    tokenEstimate: 0,
  };
}

function answer(claims: { claim: string; source_ids: string[] }[]): ModelAnswer {
  return {
    scope_status: 'grounded',
    short_answer: 'Kết luận.',
    analysis: claims,
    missing_information: [],
    follow_up_question: null,
  };
}

const rateContext: BuiltContext = {
  sources: [
    {
      chunkId: 'bhyt-rate',
      documentNumber: '188/2025/NĐ-CP',
      label: '188/2025/NĐ-CP · Điều 7 · Khoản 1',
      bodyText:
        'Mức đóng bảo hiểm y tế hằng tháng của đối tượng tham gia bằng 4,5% mức tiền lương làm căn cứ đóng bảo hiểm y tế.',
      pageFrom: 5,
      pageTo: 5,
    },
  ],
  sourceIds: ['bhyt-rate'],
  contextText: '[bhyt-rate] Mức đóng bảo hiểm y tế hằng tháng ...',
  tokenEstimate: 30,
};

const mixedRateContext: BuiltContext = {
  sources: [
    {
      chunkId: 'bhxh-rate',
      documentNumber: '158/2025/NĐ-CP',
      label: '158/2025/NĐ-CP · Điều 12 · Khoản 1',
      bodyText:
        'Người lao động hằng tháng đóng bằng 8% mức tiền lương làm căn cứ đóng bảo hiểm xã hội bắt buộc vào quỹ hưu trí và tử tuất.',
      pageFrom: 8,
      pageTo: 8,
    },
    ...rateContext.sources,
  ],
  sourceIds: ['bhxh-rate', ...rateContext.sourceIds],
  contextText: '[bhxh-rate] ... [bhyt-rate] ...',
  tokenEstimate: 50,
};

function verifyModel(model: ModelAnswer, built: BuiltContext) {
  return verifyAnswer(model, built, 'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?');
}

describe('verifyAnswer', () => {
  it('filters claims with invalid evidence and downgrades grounded scope to partial', () => {
    const result = verifyAnswer(
      answer([
        { claim: 'Mệnh đề đúng, mức đóng là 17%.', source_ids: ['a'] },
        { claim: 'Mệnh đề sai, mức đóng là 99%.', source_ids: ['a'] },
      ]),
      context(['a', 'b']),
    );
    expect(result.analysis).toHaveLength(1);
    expect(result.analysis[0].claim).toBe('Mệnh đề đúng, mức đóng là 17%.');
    expect(result.scopeStatus).toBe('partial');
  });

  it('fails closed to the safe fallback when no claim survives deterministic checks', () => {
    const result = verifyAnswer(answer([{ claim: 'Mệnh đề sai, mức đóng là 99%.', source_ids: ['a'] }]), context(['a']));
    expect(result).toEqual(SAFE_FALLBACK);
  });

  it('fails closed when a partial response has no surviving supported claim', () => {
    const result = verifyAnswer(
      {
        ...answer([{ claim: 'Mệnh đề sai, mức đóng là 99%.', source_ids: ['a'] }]),
        scope_status: 'partial',
      },
      context(['a']),
    );
    expect(result).toEqual(SAFE_FALLBACK);
  });

  it('keeps a fully supported grounded answer grounded and derives short-answer citations', () => {
    const result = verifyAnswer(answer([{ claim: 'Mệnh đề đúng, mức đóng là 17%.', source_ids: ['a'] }]), context(['a']));
    expect(result.scopeStatus).toBe('grounded');
    expect(result.analysis).toHaveLength(1);
    expect(result.shortAnswerSourceIds).toEqual(['a']);
  });

  it('drops a legacy ai_supplement field instead of exposing unverified text', () => {
    const parsed = answerSchema.parse({
      ...answer([{ claim: 'Mệnh đề đúng, mức đóng là 17%.', source_ids: ['a'] }]),
      ai_supplement: 'Một diễn giải chưa có căn cứ riêng.',
    });
    const result = verifyAnswer(parsed, context(['a']));
    expect(parsed).not.toHaveProperty('ai_supplement');
    expect(result).not.toHaveProperty('aiSupplement');
  });

  it('returns a complete out-of-scope fallback with a concrete next step', () => {
    expect(SAFE_FALLBACK.shortAnswer).toMatch(/bốn nghị định/i);
    expect(SAFE_FALLBACK.shortAnswer).toMatch(/không thể.*chính xác/i);
    expect(SAFE_FALLBACK.missingInformation.length).toBeGreaterThan(0);
    expect(SAFE_FALLBACK.followUpQuestion).toMatch(/văn bản|BHXH/i);
    expect(SAFE_FALLBACK.analysis).toHaveLength(0);
    expect(SAFE_FALLBACK.shortAnswerSourceIds).toEqual([]);
  });

  it('completes a clarification answer when the model omits the guidance fields', () => {
    const result = verifyAnswer(
      {
        scope_status: 'needs_clarification',
        short_answer: 'Cần thêm thông tin để trả lời chính xác.',
        analysis: [],
        missing_information: [],
        follow_up_question: null,
      },
      context(['a']),
    );

    expect(result.scopeStatus).toBe('needs_clarification');
    expect(result.missingInformation.length).toBeGreaterThan(0);
    expect(result.followUpQuestion).toMatch(/bổ sung|thuộc|đang hỏi/i);
  });
  it('adds source-backed depth when the provider returns a shallow rate answer', () => {
    const model: ModelAnswer = {
      scope_status: 'grounded',
      short_answer: 'Mức đóng bảo hiểm y tế là 4,5%.',
      analysis: [{ claim: 'Mức đóng bảo hiểm y tế là 4,5%.', source_ids: ['bhyt-rate'] }],
      missing_information: [],
      follow_up_question: null,
    };

    const answer = verifyModel(model, rateContext);

    expect(answer.analysis).toHaveLength(3);
    expect(answer.analysis.map((claim) => claim.claim).join(' ')).toMatch(/công thức|tính/i);
    expect(answer.analysis.map((claim) => claim.claim).join(' ')).not.toMatch(
      /Mức đóng bảo hiểm y tế là 4,5%\./i,
    );
    expect(answer.shortAnswer).toMatch(/số tiền cụ thể|căn cứ/i);
    expect(answer.analysis.every((claim) => claim.sourceIds.length > 0)).toBe(true);
  });

  it('adds practical depth when three provider claims are still repetitive', () => {
    const model: ModelAnswer = {
      scope_status: 'grounded',
      short_answer:
        'Mức đóng bảo hiểm y tế hằng tháng bằng 4,5% mức tiền lương làm căn cứ đóng bảo hiểm y tế.',
      analysis: [
        {
          claim: 'Mức đóng bảo hiểm y tế được quy định tại Điều 7 Khoản 1.',
          source_ids: ['bhyt-rate'],
        },
        {
          claim: 'Tỷ lệ đóng bảo hiểm y tế là 4,5%.',
          source_ids: ['bhyt-rate'],
        },
        {
          claim: 'Tiền lương làm căn cứ đóng là cơ sở xác định số tiền đóng.',
          source_ids: ['bhyt-rate'],
        },
      ],
      missing_information: [],
      follow_up_question: null,
    };

    const answer = verifyModel(model, rateContext);

    expect(answer.shortAnswer).toMatch(/số tiền thực tế|căn cứ/i);
    const analysisText = answer.analysis.map((claim) => claim.claim).join(' ');
    expect(analysisText).toMatch(/công thức/i);
    expect(analysisText).not.toMatch(/được quy định tại Điều/i);
  });

  it('never borrows a rate from an unrelated source in a mixed context', () => {
    const model: ModelAnswer = {
      scope_status: 'grounded',
      short_answer: 'Mức đóng bảo hiểm y tế hằng tháng bằng 4,5%.',
      analysis: [
        {
          claim: 'Mức đóng bảo hiểm y tế là 4,5%.',
          source_ids: ['bhyt-rate'],
        },
      ],
      missing_information: [],
      follow_up_question: null,
    };

    const answer = verifyModel(model, mixedRateContext);

    const text = [answer.shortAnswer, ...answer.analysis.map((claim) => claim.claim)].join(' ');
    expect(text).toContain('4,5%');
    expect(text).not.toContain('8%');
    expect(answer.analysis.every((claim) => claim.sourceIds.includes('bhyt-rate'))).toBe(true);
  });

  it('keeps partial status while adding source-backed depth to a partial rate answer', () => {
    const model: ModelAnswer = {
      scope_status: 'partial',
      short_answer: 'Nguồn hiện có nêu mức đóng bảo hiểm y tế là 4,5%.',
      analysis: [
        {
          claim: 'Mức đóng bảo hiểm y tế là 4,5%.',
          source_ids: ['bhyt-rate'],
        },
      ],
      missing_information: ['Mức tiền lương làm căn cứ'],
      follow_up_question: 'Mức tiền lương làm căn cứ là bao nhiêu?',
    };

    const answer = verifyModel(model, rateContext);

    expect(answer.scopeStatus).toBe('partial');
    expect(answer.analysis.length).toBeGreaterThanOrEqual(3);
    expect(answer.analysis.map((claim) => claim.claim).join(' ')).toMatch(/công thức|tính/i);
  });

  it('counts rejected model claims once and reports the downgrade reason', () => {
    const report = verifyAnswerWithReport(
      answer([
        { claim: 'Mệnh đề đúng, mức đóng là 17%.', source_ids: ['a'] },
        { claim: 'Mệnh đề sai, mức đóng là 99%.', source_ids: ['a'] },
        { claim: 'Mệnh đề sai, mức đóng là 98%.', source_ids: ['a'] },
      ]),
      context(['a']),
    );

    expect(report.rejectedClaimCount).toBe(2);
    expect(report.answer.scopeStatus).toBe('partial');
    expect(report.answer.analysis).toHaveLength(1);
    expect(report.reasons).toEqual(
      expect.arrayContaining(['validator_numeric_mismatch', 'grounded_downgraded_to_partial']),
    );
  });

  it('keeps a grounded badge when only system-added depth claims were appended', () => {
    const report = verifyAnswerWithReport(
      {
        scope_status: 'grounded',
        short_answer: 'Mức đóng bảo hiểm y tế là 4,5%.',
        analysis: [{ claim: 'Mức đóng bảo hiểm y tế là 4,5%.', source_ids: ['bhyt-rate'] }],
        missing_information: [],
        follow_up_question: null,
      },
      rateContext,
      'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?',
    );

    expect(report.rejectedClaimCount).toBe(0);
    expect(report.answer.scopeStatus).toBe('grounded');
    expect(report.answer.analysis.length).toBeGreaterThanOrEqual(3);
  });

  it('labels a model out-of-scope decision distinctly from a validation failure', () => {
    const report = verifyAnswerWithReport(
      { ...answer([]), scope_status: 'out_of_scope' },
      context(['a']),
    );
    expect(report.answer).toEqual(SAFE_FALLBACK);
    expect(report.reasons).toEqual(['model_out_of_scope']);
  });

});

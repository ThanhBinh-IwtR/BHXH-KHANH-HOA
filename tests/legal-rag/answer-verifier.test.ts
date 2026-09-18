import { describe, expect, it } from 'vitest';

import type { ModelAnswer } from '@/features/legal-rag/answer-schema';
import type { BuiltContext } from '@/features/legal-rag/context-builder';
import { SAFE_FALLBACK, verifyAnswer } from '@/features/legal-rag/answer-verifier';

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
    ai_supplement: null,
    missing_information: [],
    follow_up_question: null,
  };
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

  it('does not expose an unverified supplement without a second semantic model', () => {
    const result = verifyAnswer(
      {
        ...answer([{ claim: 'Mệnh đề đúng, mức đóng là 17%.', source_ids: ['a'] }]),
        ai_supplement: 'Một diễn giải chưa có căn cứ riêng.',
      },
      context(['a']),
    );
    expect(result.aiSupplement).toBeNull();
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
        ai_supplement: null,
        missing_information: [],
        follow_up_question: null,
      },
      context(['a']),
    );

    expect(result.scopeStatus).toBe('needs_clarification');
    expect(result.missingInformation.length).toBeGreaterThan(0);
    expect(result.followUpQuestion).toMatch(/bổ sung|thuộc|đang hỏi/i);
  });
});

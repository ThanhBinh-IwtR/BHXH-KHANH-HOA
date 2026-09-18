import { describe, expect, it } from 'vitest';

import { validateAnswer } from '@/features/legal-rag/answer-validator';
import type { BuiltContext } from '@/features/legal-rag/context-builder';

function contextWith(ids: string[], bodies: Record<string, string> = {}): BuiltContext {
  return {
    sources: ids.map((id) => ({
      chunkId: id,
      documentNumber: '158/2025/NĐ-CP',
      label: id,
      bodyText: bodies[id] ?? 'Nội dung nguồn.',
      pageFrom: 1,
      pageTo: 1,
    })),
    sourceIds: ids,
    contextText: '',
    tokenEstimate: 0,
  };
}

function answerWith(sourceId: string) {
  return {
    scope_status: 'grounded',
    analysis: [{ claim: 'Quy định áp dụng.', source_ids: [sourceId] }],
  };
}

function answerWithClaim(claim: string, sourceIds: string[]) {
  return { scope_status: 'grounded', analysis: [{ claim, source_ids: sourceIds }] };
}

describe('validateAnswer', () => {
  it('rejects source IDs that were not supplied to the model', () => {
    const result = validateAnswer(answerWith('invented:id'), contextWith(['real:id']));
    expect(result.ok).toBe(false);
    expect(result.issues[0].code).toBe('UNKNOWN_SOURCE_ID');
  });

  it('rejects numeric legal claims without sources', () => {
    const result = validateAnswer(answerWithClaim('Thời hạn là 30 ngày', []), contextWith([]));
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'MISSING_SOURCE')).toBe(true);
  });

  it('accepts a grounded claim whose sources are all in context', () => {
    const result = validateAnswer(answerWith('real:id'), contextWith(['real:id']));
    expect(result.ok).toBe(true);
  });

  it('rejects an empty short answer before semantic verification', () => {
    const result = validateAnswer(
      { scope_status: 'grounded', short_answer: '   ', analysis: [{ claim: 'Có căn cứ.', source_ids: ['real:id'] }] },
      contextWith(['real:id']),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'INVALID_SHORT_ANSWER')).toBe(true);
  });

  it('rejects a verbatim quote that does not match the cited source', () => {
    const result = validateAnswer(
      { scope_status: 'grounded', analysis: [{ claim: 'Nguồn nói “tỷ lệ 99 phần trăm”.', source_ids: ['real:id'] }] },
      contextWith(['real:id'], { 'real:id': 'Tỷ lệ đóng là 17 phần trăm.' }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'QUOTE_MISMATCH')).toBe(true);
  });

  it('accepts a verbatim quote that matches the cited source', () => {
    const result = validateAnswer(
      { scope_status: 'grounded', analysis: [{ claim: 'Nguồn nói “17 phần trăm”.', source_ids: ['real:id'] }] },
      contextWith(['real:id'], { 'real:id': 'Tỷ lệ đóng là 17 phần trăm vào quỹ.' }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a numeric claim when the cited source contains a different number', () => {
    const result = validateAnswer(
      { scope_status: 'grounded', analysis: [{ claim: 'Mức đóng là 99%.', source_ids: ['real:id'] }] },
      contextWith(['real:id'], { 'real:id': 'Mức đóng là 17%.' }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'NUMERIC_MISMATCH')).toBe(true);
  });

  it('rejects a short answer number that is not present in its cited analysis sources', () => {
    const result = validateAnswer(
      {
        scope_status: 'grounded',
        short_answer: 'Mức đóng là 99%.',
        analysis: [{ claim: 'Mức đóng được nêu trong nguồn.', source_ids: ['real:id'] }],
      },
      contextWith(['real:id'], { 'real:id': 'Mức đóng là 17%.' }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'SHORT_ANSWER_MISMATCH')).toBe(true);
  });

  it('rejects an Điều/Khoản reference that disagrees with the cited source label', () => {
    const context = contextWith(['real:id']);
    const relabeledContext = {
      ...context,
      sources: context.sources.map((source) => ({
        ...source,
        label: '158/2025/NĐ-CP · Điều 12 · Khoản 3',
      })),
    };
    const result = validateAnswer(
      answerWithClaim('Khoản 4 Điều 12 quy định mức đóng.', ['real:id']),
      relabeledContext,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'REFERENCE_MISMATCH')).toBe(true);
  });

  it('rejects a date that is not present in the cited source body', () => {
    const result = validateAnswer(
      answerWithClaim('Áp dụng từ ngày 01/01/2026.', ['real:id']),
      contextWith(['real:id'], { 'real:id': 'Áp dụng từ ngày 01/01/2025.' }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'DATE_MISMATCH')).toBe(true);
  });

  it('rejects an important participant category that is absent from the cited source', () => {
    const result = validateAnswer(
      answerWithClaim('Người sử dụng lao động phải đóng theo quy định.', ['real:id']),
      contextWith(['real:id'], { 'real:id': 'Người lao động phải đóng theo quy định.' }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'REFERENCE_MISMATCH')).toBe(true);
  });

  it('does not combine an article from one source label with a clause from another', () => {
    const context = {
      ...contextWith(['article:id', 'clause:id']),
      sources: [
        {
          ...contextWith(['article:id']).sources[0],
          label: '158/2025/NĐ-CP · Điều 12 · Khoản 3',
        },
        {
          ...contextWith(['clause:id']).sources[0],
          label: '158/2025/NĐ-CP · Điều 11 · Khoản 4',
        },
      ],
    };
    const result = validateAnswer(
      answerWithClaim('Khoản 4 Điều 12 quy định mức đóng.', ['article:id', 'clause:id']),
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'REFERENCE_MISMATCH')).toBe(true);
  });
});

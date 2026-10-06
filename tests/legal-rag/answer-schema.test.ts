import { describe, expect, it } from 'vitest';
import { answerSchema } from '@/features/legal-rag/answer-schema';

describe('answerSchema', () => {
  it('accepts a grounded claim with source IDs', () => {
    expect(answerSchema.parse({
      scope_status: 'grounded',
      short_answer: 'Có căn cứ.',
      analysis: [{ claim: 'Quy định áp dụng.', source_ids: ['nd158-2025:dieu-1:khoan-1:v1'] }],
      missing_information: [],
      follow_up_question: null,
    }).scope_status).toBe('grounded');
  });

  it('rejects a grounded claim without sources', () => {
    expect(() => answerSchema.parse({
      scope_status: 'grounded', short_answer: 'Sai',
      analysis: [{ claim: 'Không nguồn', source_ids: [] }],
      missing_information: [], follow_up_question: null,
    })).toThrow();
  });

  it('rejects a grounded answer without claims', () => {
    expect(() => answerSchema.parse({
      scope_status: 'grounded',
      short_answer: 'Sai',
      analysis: [],
      missing_information: [],
      follow_up_question: null,
    })).toThrow();
  });

  it('rejects more than five analysis claims to keep output bounded', () => {
    expect(() => answerSchema.parse({
      scope_status: 'grounded',
      short_answer: 'Có căn cứ.',
      analysis: Array.from({ length: 6 }, (_, index) => ({
        claim: `Mệnh đề ${index}`,
        source_ids: ['source'],
      })),
      missing_information: [],
      follow_up_question: null,
    })).toThrow();
  });
});

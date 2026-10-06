import { describe, expect, it } from 'vitest';

import { generateAnswer } from '@/features/legal-rag/answer-generator';
import type { BuiltContext } from '@/features/legal-rag/context-builder';
import { GENERATION_SYSTEM_PROMPT } from '@/features/legal-rag/prompts';
import { InvalidModelOutputError } from '@/lib/ai/errors';

import { FakeLlm } from './fakes';

const context: BuiltContext = {
  sources: [
    { chunkId: 'a', documentNumber: '158/2025/NĐ-CP', label: 'a', bodyText: 'Nội dung.', pageFrom: 1, pageTo: 1 },
  ],
  sourceIds: ['a'],
  contextText: '[a] Nội dung.',
  tokenEstimate: 5,
};

const validAnswer = {
  scope_status: 'grounded',
  short_answer: 'Có căn cứ.',
  analysis: [{ claim: 'Quy định áp dụng.', source_ids: ['a'] }],
  missing_information: [],
  follow_up_question: null,
};

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

describe('generateAnswer', () => {
  it('uses scope-aware answer budgets instead of a short hard cap', () => {
    expect(GENERATION_SYSTEM_PROMPT).toContain('grounded');
    expect(GENERATION_SYSTEM_PROMPT).toContain('250–450');
    expect(GENERATION_SYSTEM_PROMPT).toContain('partial');
    expect(GENERATION_SYSTEM_PROMPT).toContain('180–350');
    expect(GENERATION_SYSTEM_PROMPT).toContain('100–180');
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/tổng hợp|tổng hợp lại/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/3–5 mục phân tích/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/quy định trực tiếp/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/điều kiện.*đối tượng/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/cách áp dụng/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/ngoại lệ|giới hạn/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/không lặp lại câu hỏi/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/nguồn liên quan trực tiếp/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/ít nhất 3|tối thiểu 3/i);
    expect(GENERATION_SYSTEM_PROMPT).toMatch(/công thức|cách tính/i);
    expect(GENERATION_SYSTEM_PROMPT).not.toContain('tối đa 80 từ');
    expect(GENERATION_SYSTEM_PROMPT).not.toContain('tối đa 3 mệnh đề');
  });

  it('removes the never-displayed ai_supplement field from the prompt contract', () => {
    expect(GENERATION_SYSTEM_PROMPT).not.toContain('ai_supplement');
  });

  it('returns the parsed model answer without depth enrichment (verification owns it)', async () => {
    const shallow = {
      scope_status: 'grounded',
      short_answer: 'Mức đóng bảo hiểm y tế là 4,5%.',
      analysis: [{ claim: 'Mức đóng bảo hiểm y tế là 4,5%.', source_ids: ['bhyt-rate'] }],
      missing_information: [],
      follow_up_question: null,
    };
    const answer = await generateAnswer(
      'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?',
      rateContext,
      new FakeLlm([shallow]),
    );
    expect(answer).toEqual(shallow);
  });

  it('returns a valid answer on the first attempt', async () => {
    const llm = new FakeLlm([validAnswer]);
    const answer = await generateAnswer('Câu hỏi', context, llm);
    expect(answer.scope_status).toBe('grounded');
    expect(llm.calls).toBe(1);
  });

  it('does not call the model again when the first structured payload is invalid', async () => {
    const llm = new FakeLlm([{ bad: true }]);
    await expect(generateAnswer('Câu hỏi', context, llm)).rejects.toBeInstanceOf(
      InvalidModelOutputError,
    );
    expect(llm.calls).toBe(1);
  });
});

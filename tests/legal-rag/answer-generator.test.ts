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
  ai_supplement: null,
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

  it('adds source-backed depth when the provider returns a shallow rate answer', async () => {
    const llm = new FakeLlm([
      {
        scope_status: 'grounded',
        short_answer: 'Mức đóng bảo hiểm y tế là 4,5%.',
        analysis: [{ claim: 'Mức đóng bảo hiểm y tế là 4,5%.', source_ids: ['bhyt-rate'] }],
        ai_supplement: null,
        missing_information: [],
        follow_up_question: null,
      },
    ]);

    const answer = await generateAnswer(
      'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?',
      rateContext,
      llm,
    );

    expect(answer.analysis).toHaveLength(3);
    expect(answer.analysis.map((claim) => claim.claim).join(' ')).toMatch(/công thức|tính/i);
    expect(answer.analysis.map((claim) => claim.claim).join(' ')).not.toMatch(
      /Mức đóng bảo hiểm y tế là 4,5%\./i,
    );
    expect(answer.short_answer).toMatch(/số tiền cụ thể|căn cứ/i);
    expect(answer.analysis.every((claim) => claim.source_ids.length > 0)).toBe(true);
  });

  it('adds practical depth when three provider claims are still repetitive', async () => {
    const llm = new FakeLlm([
      {
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
        ai_supplement: null,
        missing_information: [],
        follow_up_question: null,
      },
    ]);

    const answer = await generateAnswer(
      'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?',
      rateContext,
      llm,
    );

    expect(answer.short_answer).toMatch(/số tiền thực tế|căn cứ/i);
    const analysisText = answer.analysis.map((claim) => claim.claim).join(' ');
    expect(analysisText).toMatch(/công thức/i);
    expect(analysisText).not.toMatch(/được quy định tại Điều/i);
  });

  it('never borrows a rate from an unrelated source in a mixed context', async () => {
    const llm = new FakeLlm([
      {
        scope_status: 'grounded',
        short_answer: 'Mức đóng bảo hiểm y tế hằng tháng bằng 4,5%.',
        analysis: [
          {
            claim: 'Mức đóng bảo hiểm y tế là 4,5%.',
            source_ids: ['bhyt-rate'],
          },
        ],
        ai_supplement: null,
        missing_information: [],
        follow_up_question: null,
      },
    ]);

    const answer = await generateAnswer(
      'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?',
      mixedRateContext,
      llm,
    );

    const text = [answer.short_answer, ...answer.analysis.map((claim) => claim.claim)].join(' ');
    expect(text).toContain('4,5%');
    expect(text).not.toContain('8%');
    expect(answer.analysis.every((claim) => claim.source_ids.includes('bhyt-rate'))).toBe(true);
  });

  it('keeps partial status while adding source-backed depth to a partial rate answer', async () => {
    const llm = new FakeLlm([
      {
        scope_status: 'partial',
        short_answer: 'Nguồn hiện có nêu mức đóng bảo hiểm y tế là 4,5%.',
        analysis: [
          {
            claim: 'Mức đóng bảo hiểm y tế là 4,5%.',
            source_ids: ['bhyt-rate'],
          },
        ],
        ai_supplement: null,
        missing_information: ['Mức tiền lương làm căn cứ'],
        follow_up_question: 'Mức tiền lương làm căn cứ là bao nhiêu?',
      },
    ]);

    const answer = await generateAnswer(
      'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?',
      rateContext,
      llm,
    );

    expect(answer.scope_status).toBe('partial');
    expect(answer.analysis.length).toBeGreaterThanOrEqual(3);
    expect(answer.analysis.map((claim) => claim.claim).join(' ')).toMatch(/công thức|tính/i);
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

import { describe, expect, it } from 'vitest';

import type { LlmCallOptions, LlmClient } from '@/lib/ai/contracts';
import { ModelOutputTruncatedError } from '@/lib/ai/errors';
import {
  getRagFailureDiagnostics,
  runRag,
  type RagServiceDeps,
} from '@/features/legal-rag/service';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';

import { FakeEmbedder, FakeLlm, IdentityReranker } from './fakes';

const SOURCE_ID = 'nd-158-2025:dieu-12:khoan-3:2025-demo-v1';

class CapturingGenerator implements LlmClient {
  readonly prompts: string[] = [];

  async generateStructured<T>(input: { system: string; user: string; schemaName: string }): Promise<T> {
    this.prompts.push(input.user);
    return {
      scope_status: 'grounded',
      short_answer: 'Người sử dụng lao động đóng 17%.',
      analysis: [{ claim: 'Tỷ lệ đóng là 17%.', source_ids: [SOURCE_ID] }],
      missing_information: [],
      follow_up_question: null,
    } as T;
  }
}

class TruncatingLlm implements LlmClient {
  calls = 0;
  async generateStructured<T>(
    _input: { system: string; user: string; schemaName: string },
    options?: LlmCallOptions,
  ): Promise<T> {
    this.calls += 1;
    options?.onUsage?.({ finishReason: 'length', completionTokens: 2048 });
    throw new ModelOutputTruncatedError();
  }
}

class UsageReportingLlm implements LlmClient {
  async generateStructured<T>(
    _input: { system: string; user: string; schemaName: string },
    options?: LlmCallOptions,
  ): Promise<T> {
    options?.onUsage?.({ finishReason: 'stop', completionTokens: 612 });
    return {
      scope_status: 'grounded',
      short_answer: 'Người sử dụng lao động đóng 17%.',
      analysis: [{ claim: 'Tỷ lệ đóng là 17%.', source_ids: [SOURCE_ID] }],
      missing_information: [],
      follow_up_question: null,
    } as T;
  }
}

function deps(generator: LlmClient): RagServiceDeps {
  return {
    repository: new MemoryLegalRepository(sampleCorpus),
    embedder: new FakeEmbedder([3, 1, 0, 2, 0, 0, 1, 0]),
    reranker: new IdentityReranker(),
    generator,
    corpusVersion: sampleCorpusVersion,
  };
}

describe('runRag conversation question', () => {
  it('returns a grounded answer with one generator call and deterministic verification', async () => {
    const generator = new FakeLlm([
      {
        scope_status: 'grounded',
        short_answer: 'Người sử dụng lao động đóng 17%.',
        analysis: [{ claim: 'Tỷ lệ đóng là 17%.', source_ids: [SOURCE_ID] }],
        missing_information: [],
        follow_up_question: null,
      },
    ]);
    const result = await runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      deps(generator),
    );

    expect(result.response.scopeStatus).toBe('grounded');
    expect(generator.calls).toBe(1);
    expect(result.stageTimings.verificationMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics).toMatchObject({
      llmCallCount: 1,
      rejectedClaimCount: 0,
    });
  });

  it('restores answer depth but downgrades to partial after validation rejects a claim', async () => {
    const generator = new FakeLlm([
      {
        scope_status: 'grounded',
        short_answer: 'Người sử dụng lao động đóng 17%.',
        analysis: [
          {
            claim: 'Người sử dụng lao động đóng 17%.',
            source_ids: [SOURCE_ID],
          },
          {
            claim: 'Người sử dụng lao động của doanh nghiệp lớn đóng 99% vào quỹ hưu trí và tử tuất.',
            source_ids: [SOURCE_ID],
          },
          {
            claim: 'Tỷ lệ này được nêu trong căn cứ pháp lý.',
            source_ids: [SOURCE_ID],
          },
        ],
        missing_information: [],
        follow_up_question: null,
      },
    ]);

    const result = await runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      deps(generator),
    );

    // Decision (P1-07): a rejected model claim means the full answer was not
    // verified, so the badge drops to partial even though depth is restored.
    expect(result.response.scopeStatus).toBe('partial');
    expect(result.response.analysis.length).toBeGreaterThanOrEqual(3);
    expect(result.response.shortAnswer).toMatch(/số tiền thực tế|căn cứ/i);
    expect(result.response.shortAnswer).toMatch(/chỉ hỗ trợ một phần/i);
    expect(result.metrics).toMatchObject({ llmCallCount: 1, rejectedClaimCount: 1 });
    expect(result.metrics.downgradeReasons).toEqual(
      expect.arrayContaining(['validator_numeric_mismatch', 'grounded_downgraded_to_partial']),
    );
  });

  it('fails closed with a public safe answer after one malformed model response', async () => {
    const generator = new FakeLlm([{ malformed: true }]);
    const result = await runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      deps(generator),
    );

    expect(result.response.scopeStatus).toBe('out_of_scope');
    expect(result.response.shortAnswer).toMatch(/đối chiếu|căn cứ/i);
    expect(generator.calls).toBe(1);
    expect(result.metrics).toMatchObject({ llmCallCount: 1, rejectedClaimCount: 0 });
    expect(result.metrics.downgradeReasons).toContain('invalid_model_output');
  });

  it('canonicalises an explicit legal reference in the verified short answer', async () => {
    const generator = new FakeLlm([
      {
        scope_status: 'grounded',
        short_answer:
          'Quy định người sử dụng lao động đóng 17%.',
        analysis: [
          {
            claim: 'Người sử dụng lao động đóng 17% vào quỹ hưu trí và tử tuất.',
            source_ids: [SOURCE_ID],
          },
        ],
        missing_information: [],
        follow_up_question: null,
      },
    ]);

    const result = await runRag(
      {
        message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?',
        history: [],
      },
      deps(generator),
    );

    expect(result.response.shortAnswer).toBe(
      'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định: người sử dụng lao động đóng 17%. Tỷ lệ này được áp dụng trên quỹ tiền lương làm căn cứ đóng bảo hiểm xã hội bắt buộc của người lao động, nên số tiền thực tế phụ thuộc vào mức căn cứ của trường hợp cụ thể.',
    );
  });

  it('uses the rewritten standalone question for generation after a follow-up', async () => {
    const generator = new CapturingGenerator();

    await runRag(
      {
        message: 'Vậy trường hợp đó thì sao?',
        history: [
          {
            role: 'user',
            content: 'Người sử dụng lao động đóng bao nhiêu vào quỹ hưu trí và tử tuất?',
          },
        ],
      },
      deps(generator),
    );

    expect(generator.prompts[0]).toContain(
      'Người sử dụng lao động đóng bao nhiêu vào quỹ hưu trí và tử tuất? Vậy trường hợp đó thì sao?',
    );
  });

  it.each([
    [
      'Còn mức đóng này thì sao?',
      'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu? Còn mức đóng này thì sao?',
    ],
    [
      'Nếu áp dụng cho tôi thì sao?',
      'Người sử dụng lao động đóng bao nhiêu vào quỹ hưu trí và tử tuất? Nếu áp dụng cho tôi thì sao?',
    ],
  ])('uses the same standalone wording for continuation %s', async (message, standalone) => {
    const generator = new CapturingGenerator();

    await runRag(
      {
        message,
        history: [{ role: 'user', content: standalone.split(` ${message}`)[0] }],
      },
      deps(generator),
    );

    expect(generator.prompts[0]).toContain(standalone);
  });

  it('keeps an independent one-turn question unchanged for generation', async () => {
    const generator = new CapturingGenerator();

    await runRag(
      { message: 'Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      deps(generator),
    );

    expect(generator.prompts[0]).toContain('Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?');
  });

  it('returns out_of_scope without calling the generator for weak vector-only evidence', async () => {
    const generator = new FakeLlm([]);
    const result = await runRag(
      { message: 'Tôi cần làm hộ chiếu mới ở đâu?', history: [] },
      {
        repository: new MemoryLegalRepository(sampleCorpus),
        embedder: new FakeEmbedder([1, 0, 0, 0, 0, 0, 0, 0]),
        reranker: new IdentityReranker(),
        generator,
        corpusVersion: sampleCorpusVersion,
      },
    );

    expect(result.response.scopeStatus).toBe('out_of_scope');
    expect(generator.calls).toBe(0);
    expect(result.metrics.llmCallCount).toBe(0);
  });

  it('answers an explicit clarification intent without retrieval or generation', async () => {
    const generator = new FakeLlm([]);
    const result = await runRag(
      { message: 'Cần làm rõ loại bảo hiểm trước khi xác định mức đóng.', history: [] },
      {
        repository: new MemoryLegalRepository(sampleCorpus),
        embedder: new FakeEmbedder(),
        reranker: new IdentityReranker(),
        generator,
        corpusVersion: sampleCorpusVersion,
      },
    );

    expect(result.response.scopeStatus).toBe('needs_clarification');
    expect(result.response.followUpQuestion).toBe('Bạn đang hỏi BHXH bắt buộc hay tự nguyện?');
    expect(result.metrics.llmCallCount).toBe(0);
    expect(result.stageTimings.retrievalMs).toBe(0);
    expect(generator.calls).toBe(0);
  });

  it('answers an obviously out-of-scope request before retrieval or generation', async () => {
    const embedder = new FakeEmbedder();
    const generator = new FakeLlm([]);
    const result = await runRag(
      { message: 'Tôi cần làm hộ chiếu mới ở đâu?', history: [] },
      {
        repository: new MemoryLegalRepository(sampleCorpus),
        embedder,
        reranker: new IdentityReranker(),
        generator,
        corpusVersion: sampleCorpusVersion,
      },
    );

    expect(result.response.scopeStatus).toBe('out_of_scope');
    expect(result.metrics.llmCallCount).toBe(0);
    expect(result.stageTimings.retrievalMs).toBe(0);
    expect(embedder.calls).toBe(0);
    expect(generator.calls).toBe(0);
  });

  it('does not preflight a legal reference that merely asks for clarification', async () => {
    const generator = new FakeLlm([
      {
        scope_status: 'grounded',
        short_answer: 'Người sử dụng lao động đóng 17%.',
        analysis: [{ claim: 'Tỷ lệ đóng là 17%.', source_ids: [SOURCE_ID] }],
        missing_information: [],
        follow_up_question: null,
      },
    ]);
    const result = await runRag(
      {
        message: 'Xin làm rõ Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP.',
        history: [],
      },
      deps(generator),
    );

    expect(result.response.scopeStatus).toBe('grounded');
    expect(result.metrics.llmCallCount).toBe(1);
    expect(generator.calls).toBe(1);
  });
  it('surfaces output truncation as a classified error, never as out_of_scope', async () => {
    const generator = new TruncatingLlm();
    const error = await runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      deps(generator),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ModelOutputTruncatedError);
    expect(generator.calls).toBe(1);
    expect(getRagFailureDiagnostics(error)).toMatchObject({
      stage: 'generation',
      reason: 'output_truncated',
      metrics: {
        llmCallCount: 1,
        finishReason: 'length',
        completionTokens: 2048,
        downgradeReasons: expect.arrayContaining(['output_truncated']),
      },
    });
  });

  it('records the provider stop reason and completion tokens of a successful call', async () => {
    const result = await runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      deps(new UsageReportingLlm()),
    );

    expect(result.metrics).toMatchObject({ finishReason: 'stop', completionTokens: 612 });
  });

  it('labels a model out-of-scope decision separately from schema and truncation failures', async () => {
    const generator = new FakeLlm([
      {
        scope_status: 'out_of_scope',
        short_answer: 'Không có căn cứ.',
        analysis: [],
        missing_information: [],
        follow_up_question: null,
      },
    ]);
    const result = await runRag(
      { message: 'Khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?', history: [] },
      deps(generator),
    );

    expect(result.response.scopeStatus).toBe('out_of_scope');
    expect(result.metrics.downgradeReasons).toContain('model_out_of_scope');
    expect(result.metrics.downgradeReasons).not.toContain('invalid_model_output');
    expect(result.metrics.downgradeReasons).not.toContain('output_truncated');
  });
});

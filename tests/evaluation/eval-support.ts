import type { LlmClient } from '@/lib/ai/contracts';
import { MemoryLegalRepository } from '@/lib/db/memory-legal-repository';
import { sampleCorpus, sampleCorpusVersion } from '@/lib/db/sample-corpus';
import type { RagServiceDeps } from '@/features/legal-rag/service';

import { FakeEmbedder, IdentityReranker } from '../legal-rag/fakes';

/**
 * A deterministic LLM stand-in for evaluation: it only ever cites source IDs it
 * was actually given, and it ignores any instruction embedded in the prompt —
 * exactly the behaviour the real prompt contract demands.
 */
export class EchoingLlm implements LlmClient {
  calls = 0;

  async generateStructured<T>(input: { system: string; user: string; schemaName: string }): Promise<T> {
    this.calls += 1;
    const ids = idsFrom(input.user);
    if (input.user.includes('Cần xác nhận một phần')) {
      return {
        scope_status: 'partial',
        short_answer: 'Nguồn hiện có chỉ xác nhận một phần nội dung câu hỏi.',
        analysis: [{ claim: 'Nguồn được cung cấp có nêu quy định liên quan.', source_ids: [ids[0]] }],
        ai_supplement: null,
        missing_information: ['Phần điều kiện còn lại cần đối chiếu'],
        follow_up_question: 'Bạn có thể bổ sung dữ kiện hoặc đối chiếu phần còn lại với văn bản chính thức?',
      } as T;
    }
    if (input.user.includes('Cần làm rõ nhóm đối tượng')) {
      return {
        scope_status: 'needs_clarification',
        short_answer: 'Cần thêm thông tin để trả lời chính xác.',
        analysis: [],
        ai_supplement: null,
        missing_information: ['Nhóm đối tượng tham gia'],
        follow_up_question: 'Bạn thuộc nhóm đối tượng nào?',
      } as T;
    }
    if (input.user.includes('Cần làm rõ loại bảo hiểm')) {
      return {
        scope_status: 'needs_clarification',
        short_answer: 'Cần thêm thông tin để trả lời chính xác.',
        analysis: [],
        ai_supplement: null,
        missing_information: ['Loại bảo hiểm'],
        follow_up_question: 'Bạn đang hỏi BHXH bắt buộc hay tự nguyện?',
      } as T;
    }
    if (ids.length === 0) {
      return {
        scope_status: 'out_of_scope',
        short_answer: 'Không có căn cứ trong bộ tài liệu.',
        analysis: [],
        ai_supplement: null,
        missing_information: [],
        follow_up_question: null,
      } as T;
    }
    return {
      scope_status: 'grounded',
      short_answer: 'Mức đóng được quy định trong nguồn dẫn chiếu.',
      analysis: [{ claim: 'Quy định về mức đóng được nêu tại nguồn.', source_ids: [ids[0]] }],
      ai_supplement: null,
      missing_information: [],
      follow_up_question: null,
    } as T;
  }
}

function idsFrom(prompt: string): string[] {
  const ids = [
    ...prompt.matchAll(/^ID:\s*(\S+)/gm),
    ...prompt.matchAll(/^\s*\[([^\]]+)\]/gm),
  ].map((match) => match[1]);
  return [...new Set(ids)];
}

export function buildEvaluationDeps(): RagServiceDeps {
  return {
    repository: new MemoryLegalRepository(sampleCorpus),
    // Empty query vector forces deterministic keyword-only hybrid retrieval.
    embedder: new FakeEmbedder([]),
    reranker: new IdentityReranker(),
    generator: new EchoingLlm(),
    corpusVersion: sampleCorpusVersion,
  };
}

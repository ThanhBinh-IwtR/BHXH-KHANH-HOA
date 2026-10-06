import type { LlmCallOptions, LlmClient } from '@/lib/ai/contracts';
import { InvalidModelOutputError } from '@/lib/ai/errors';

import { answerSchema, type ModelAnswer } from './answer-schema';
import type { BuiltContext } from './context-builder';
import { GENERATION_SYSTEM_PROMPT, buildGenerationUserPrompt } from './prompts';

/**
 * Generate one structured answer; schema failures fail closed without a second
 * LLM call. Depth enrichment and grounding checks happen once, in verification.
 */
export async function generateAnswer(
  question: string,
  context: BuiltContext,
  llm: LlmClient,
  options: LlmCallOptions = {},
): Promise<ModelAnswer> {
  const user = buildGenerationUserPrompt(question, context);

  const first = await llm.generateStructured<unknown>({
    system: GENERATION_SYSTEM_PROMPT,
    user,
    schemaName: 'legal_answer',
  }, options);
  const firstParse = answerSchema.safeParse(first);
  if (firstParse.success) return firstParse.data;

  throw new InvalidModelOutputError(
    `Model output did not match the required schema: ${firstParse.error.issues
      .map((issue) => issue.message)
      .join('; ')}`,
  );
}

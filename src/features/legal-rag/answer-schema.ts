import { z } from 'zod';

const claimSchema = z.object({
  claim: z.string().min(1),
  source_ids: z.array(z.string().min(1)).min(1),
});

export const answerSchema = z.object({
  scope_status: z.enum(['grounded', 'partial', 'needs_clarification', 'out_of_scope']),
  short_answer: z.string().min(1),
  analysis: z.array(claimSchema).max(5),
  ai_supplement: z.string().min(1).nullable(),
  missing_information: z.array(z.string().min(1)),
  follow_up_question: z.string().min(1).nullable(),
}).superRefine((answer, ctx) => {
  if (answer.scope_status === 'grounded' && answer.analysis.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['analysis'],
      message: 'Grounded answers require claims',
    });
  }
});

export type ModelAnswer = z.infer<typeof answerSchema>;

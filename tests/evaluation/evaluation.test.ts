import { describe, expect, it } from 'vitest';

import { loadGoldSet, runEvaluation } from './run-evaluation';
import { buildEvaluationDeps } from './eval-support';

describe('gold-set evaluation', () => {
  it('meets the acceptance thresholds on the demo corpus', async () => {
    const report = await runEvaluation(loadGoldSet(), buildEvaluationDeps());

    expect(report.total).toBeGreaterThanOrEqual(25);
    expect(report.exactLookupAccuracy).toBe(1);
    expect(report.recallAt10).toBeGreaterThanOrEqual(0.95);
    expect(report.unknownCitationCount).toBe(0);
    expect(report.uncitedClaimCount).toBe(0);
    expect(report.forbiddenViolationCount).toBe(0);
    expect(report.clarificationViolationCount).toBe(0);
    expect(report.incompleteScopeResponseCount).toBe(0);
    expect(report.scopeAccuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies out-of-scope questions without inventing evidence', async () => {
    const report = await runEvaluation(loadGoldSet(), buildEvaluationDeps());
    const outOfScope = report.cases.filter((entry) => entry.expectedScope === 'out_of_scope');
    expect(outOfScope.length).toBeGreaterThan(0);
    expect(outOfScope.every((entry) => entry.actualScope === 'out_of_scope')).toBe(true);
  });

  it('resists prompt injection embedded in a question', async () => {
    const report = await runEvaluation(loadGoldSet(), buildEvaluationDeps());
    const injection = report.cases.find((entry) => entry.id === 'injection-attempt');
    expect(injection?.forbiddenViolations).toEqual([]);
    expect(injection?.actualScope).toBe('grounded');
  });

  it('records a missing required clarification instead of silently passing it', async () => {
    const report = await runEvaluation(
      [
        {
          id: 'clarification-contract',
          question: 'Mức đóng bảo hiểm xã hội là bao nhiêu?',
          expectedScope: 'grounded',
          requiredSourceIds: [],
          forbiddenClaims: [],
          requiredClarifications: ['Bạn thuộc nhóm đối tượng nào?'],
        },
      ],
      buildEvaluationDeps(),
    );

    expect(report.clarificationViolationCount).toBe(1);
    expect(report.cases[0].clarificationViolations).toEqual(['Bạn thuộc nhóm đối tượng nào?']);
  });
});

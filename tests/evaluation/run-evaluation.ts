import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvConfig } from '@next/env';

import { retrieveEvidence } from '@/features/legal-rag/retrieval';
import { resolveStandaloneQuestion, runRag, type RagServiceDeps } from '@/features/legal-rag/service';
import type { PublicResponse } from '@/features/legal-rag/public-response';

export interface GoldHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface GoldCase {
  id: string;
  question: string;
  expectedScope: string;
  requiredSourceIds: string[];
  forbiddenClaims: string[];
  requiredClarifications: string[];
  history?: GoldHistoryTurn[];
}

export interface CaseResult {
  id: string;
  expectedScope: string;
  actualScope: string;
  scopeMatch: boolean;
  isExactLookup: boolean;
  recallHit: boolean;
  retrievalRank: number | null;
  unknownCitationIds: string[];
  uncitedClaims: number;
  forbiddenViolations: string[];
  clarificationViolations: string[];
  incompleteScopeViolations: string[];
  latencyMs: number;
}

export interface EvaluationReport {
  total: number;
  exactLookupAccuracy: number;
  recallAt10: number;
  scopeAccuracy: number;
  unknownCitationCount: number;
  uncitedClaimCount: number;
  forbiddenViolationCount: number;
  clarificationViolationCount: number;
  incompleteScopeResponseCount: number;
  cases: CaseResult[];
}

export function loadGoldSet(path?: string): GoldCase[] {
  const file =
    path ?? resolve(dirname(fileURLToPath(import.meta.url)), 'gold-set.json');
  return JSON.parse(readFileSync(file, 'utf-8')) as GoldCase[];
}

export async function runEvaluation(
  goldSet: readonly GoldCase[],
  deps: RagServiceDeps,
): Promise<EvaluationReport> {
  const cases: CaseResult[] = [];

  for (const item of goldSet) {
    const started = Date.now();
    const history = item.history ?? [];
    const standalone = resolveStandaloneQuestion(item.question, history);
    const evidence = await retrieveEvidence(
      { query: standalone, corpusVersion: deps.corpusVersion },
      deps.repository,
      deps.embedder,
      deps.reranker,
    );
    const retrievedIds = evidence.chunks.map((chunk) => chunk.chunk.chunkId);
    const ranks = item.requiredSourceIds.map((id) => retrievedIds.indexOf(id));
    const recallHit =
      item.requiredSourceIds.length === 0 || ranks.every((rank) => rank >= 0);
    const bestRank = ranks.filter((rank) => rank >= 0).sort((a, b) => a - b)[0];

    const { response } = await runRag({ message: item.question, history }, deps);

    const shortAnswerCitations = response.shortAnswerCitations ?? [];
    const citationIds = [
      ...shortAnswerCitations.map((citation) => citation.sourceId),
      ...response.analysis.flatMap((claim) => claim.citations.map((citation) => citation.sourceId)),
    ];
    const unknownCitationIds: string[] = [];
    for (const id of citationIds) {
      const exists = await deps.repository.getSource(id);
      if (!exists) unknownCitationIds.push(id);
    }

    const isGroundedScope = response.scopeStatus === 'grounded' || response.scopeStatus === 'partial';
    const uncitedClaims = isGroundedScope
      ? response.analysis.filter((claim) => claim.citations.length === 0).length +
        (shortAnswerCitations.length === 0 ? 1 : 0)
      : 0;

    const haystack = [
      response.shortAnswer,
      response.aiSupplement ?? '',
      ...response.missingInformation,
      response.followUpQuestion ?? '',
      ...response.analysis.map((claim) => claim.claim),
    ]
      .join(' ')
      .toLowerCase();
    const forbiddenViolations = item.forbiddenClaims.filter((claim) =>
      haystack.includes(claim.toLowerCase()),
    );
    const clarificationViolations = item.requiredClarifications.filter(
      (clarification) => !containsPhrase(haystack, clarification),
    );
    const incompleteScopeViolations = scopeGuidanceViolations(response);

    cases.push({
      id: item.id,
      expectedScope: item.expectedScope,
      actualScope: response.scopeStatus,
      scopeMatch: response.scopeStatus === item.expectedScope,
      isExactLookup: item.id.startsWith('exact-'),
      recallHit,
      retrievalRank: bestRank === undefined ? null : bestRank + 1,
      unknownCitationIds,
      uncitedClaims,
      forbiddenViolations,
      clarificationViolations,
      incompleteScopeViolations,
      latencyMs: Date.now() - started,
    });
  }

  const exactCases = cases.filter((entry) => entry.isExactLookup);
  const recallCases = goldSet.filter((item) => item.requiredSourceIds.length > 0);
  const recallHits = cases.filter(
    (entry, index) => goldSet[index].requiredSourceIds.length > 0 && entry.recallHit,
  );

  return {
    total: cases.length,
    exactLookupAccuracy: ratio(exactCases.filter((entry) => entry.recallHit).length, exactCases.length),
    recallAt10: ratio(recallHits.length, recallCases.length),
    scopeAccuracy: ratio(cases.filter((entry) => entry.scopeMatch).length, cases.length),
    unknownCitationCount: cases.reduce((sum, entry) => sum + entry.unknownCitationIds.length, 0),
    uncitedClaimCount: cases.reduce((sum, entry) => sum + entry.uncitedClaims, 0),
    forbiddenViolationCount: cases.reduce((sum, entry) => sum + entry.forbiddenViolations.length, 0),
    clarificationViolationCount: cases.reduce(
      (sum, entry) => sum + entry.clarificationViolations.length,
      0,
    ),
    incompleteScopeResponseCount: cases.reduce(
      (sum, entry) => sum + entry.incompleteScopeViolations.length,
      0,
    ),
    cases,
  };
}

function scopeGuidanceViolations(response: PublicResponse): string[] {
  if (response.scopeStatus === 'grounded') return [];

  const violations: string[] = [];
  if (response.shortAnswer.trim().length < 40) violations.push('short_answer_too_short');
  if (response.scopeStatus === 'partial' && response.missingInformation.length === 0) {
    violations.push('partial_missing_information');
  }
  if (response.scopeStatus === 'needs_clarification' && response.missingInformation.length === 0) {
    violations.push('clarification_missing_information');
  }
  if (!response.followUpQuestion?.trim()) violations.push('missing_follow_up');
  if (response.scopeStatus === 'out_of_scope') {
    if (response.analysis.length > 0) violations.push('out_of_scope_has_analysis');
    if (response.sources.length > 0) violations.push('out_of_scope_has_sources');
  }
  return violations;
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  return normalize(haystack).includes(normalize(phrase));
}

function ratio(hit: number, total: number): number {
  return total === 0 ? 1 : hit / total;
}

export function toMarkdown(report: EvaluationReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    '# Evaluation report',
    '',
    `- Total cases: ${report.total}`,
    `- Exact lookup accuracy: ${pct(report.exactLookupAccuracy)}`,
    `- Recall@10: ${pct(report.recallAt10)}`,
    `- Scope accuracy: ${pct(report.scopeAccuracy)}`,
    `- Fabricated citation IDs: ${report.unknownCitationCount}`,
    `- Uncited legal claims: ${report.uncitedClaimCount}`,
    `- Forbidden claim violations: ${report.forbiddenViolationCount}`,
    `- Missing required clarifications: ${report.clarificationViolationCount}`,
    `- Incomplete non-grounded responses: ${report.incompleteScopeResponseCount}`,
    '',
    '| Case | Expected | Actual | Recall | Rank | Latency |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.cases.map(
      (entry) =>
        `| ${entry.id} | ${entry.expectedScope} | ${entry.actualScope} | ${
          entry.recallHit ? '✓' : '✗'
        } | ${entry.retrievalRank ?? '-'} | ${entry.latencyMs}ms |`,
    ),
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { createRagDeps } = await import('@/features/legal-rag/service-factory');
  const report = await runEvaluation(loadGoldSet(), createRagDeps());
  const outDir = resolve(process.cwd(), 'tmp', 'evaluation');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'evaluation.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(outDir, 'evaluation.md'), toMarkdown(report));
  process.stdout.write(`${toMarkdown(report)}\n`);
  const failed =
    report.exactLookupAccuracy < 1 ||
    report.recallAt10 < 0.95 ||
    report.scopeAccuracy < 0.9 ||
    report.unknownCitationCount > 0 ||
    report.uncitedClaimCount > 0 ||
    report.forbiddenViolationCount > 0 ||
    report.clarificationViolationCount > 0 ||
    report.incompleteScopeResponseCount > 0;
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('run-evaluation.ts')) {
  void main();
}

'use client';

import { Info } from 'lucide-react';

import { AI_ACCURACY_NOTICE, type PublicResponse } from '@/features/legal-rag/public-response';
import { CitationChip } from '@/features/sources/citation-chip';

import { StatusBadge } from './status-badge';

const ANALYSIS_SECTION_LABELS = [
  'Quy định chính',
  'Điều kiện và đối tượng',
  'Cách áp dụng',
  'Ngoại lệ và giới hạn',
  'Hệ quả thực tế',
] as const;

interface AnswerCardProps {
  answer: PublicResponse;
  onOpenSource: (sourceId: string, order: string[]) => void;
}

export function AnswerCard({ answer, onOpenSource }: AnswerCardProps) {
  const order = answer.sources.map((source) => source.sourceId);
  const isClarification = answer.scopeStatus === 'needs_clarification';
  const sourceById = new Map(answer.sources.map((source) => [source.sourceId, source]));
  const seenCitationKeys = new Set<string>();
  const visibleShortCitations = takeUniqueCitations(
    answer.shortAnswerCitations ?? [],
    sourceById,
    seenCitationKeys,
  );
  const claimCitations = answer.analysis.map((claim) =>
    takeUniqueCitations(claim.citations, sourceById, seenCitationKeys),
  );
  const showAnalysisSections = answer.analysis.length > 1;

  return (
    <article className="answer-card" aria-label="Câu trả lời">
      <StatusBadge status={answer.scopeStatus} />
      <p className="answer-notice" role="note">
        {AI_ACCURACY_NOTICE}
      </p>

      <p className="answer-short">{answer.shortAnswer}</p>
      {visibleShortCitations.length > 0 && (
        <div className="answer-short-citations" aria-label="Nguồn cho kết luận ngắn">
          {visibleShortCitations.map((citation) => (
            <CitationChip
              key={citationKey(citation, sourceById.get(citation.sourceId))}
              sourceId={citation.sourceId}
              label={formatCitationLabel(citation.label, sourceById.get(citation.sourceId))}
              onOpen={(id) => onOpenSource(id, order)}
            />
          ))}
        </div>
      )}

      {!isClarification && answer.analysis.length > 0 && (
        <ol className="claim-list">
          {answer.analysis.map((claim, index) => (
            <li key={index} className="claim-item">
              <div className="claim-content">
                {showAnalysisSections && (
                  <h3 className="claim-heading">
                    {ANALYSIS_SECTION_LABELS[index] ?? `Phân tích ${index + 1}`}
                  </h3>
                )}
                <p className="claim-text">{claim.claim}</p>
                {claimCitations[index].length > 0 && (
                  <div className="claim-citations">
                    {claimCitations[index].map((citation) => (
                      <CitationChip
                        key={citationKey(citation, sourceById.get(citation.sourceId))}
                        sourceId={citation.sourceId}
                        label={formatCitationLabel(citation.label, sourceById.get(citation.sourceId))}
                        onOpen={(id) => onOpenSource(id, order)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {answer.missingInformation.length > 0 && (
        <div className="missing-info">
          <h3>Thông tin còn thiếu</h3>
          <ul>
            {answer.missingInformation.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {answer.followUpQuestion && (
        <p className="follow-up">
          <Info size={15} aria-hidden /> {answer.followUpQuestion}
        </p>
      )}

    </article>
  );
}

function formatCitationLabel(
  label: string,
  source: PublicResponse['sources'][number] | undefined,
): string {
  if (!source) return label;
  const pages =
    source.pageFrom === source.pageTo
      ? `Trang ${source.pageFrom}`
      : `Trang ${source.pageFrom}–${source.pageTo}`;
  return `${label} · ${pages}`;
}

function takeUniqueCitations(
  citations: readonly CitationLike[],
  sourceById: ReadonlyMap<string, PublicResponse['sources'][number]>,
  seenKeys: Set<string>,
): CitationLike[] {
  const unique: CitationLike[] = [];
  for (const citation of citations) {
    const key = citationKey(citation, sourceById.get(citation.sourceId));
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    unique.push(citation);
  }
  return unique;
}

function citationKey(
  citation: CitationLike,
  source: PublicResponse['sources'][number] | undefined,
): string {
  if (!source) return `source:${citation.sourceId}`;
  return [source.documentNumber, source.label, source.pageFrom, source.pageTo].join('|');
}

type CitationLike = { sourceId: string; label: string };

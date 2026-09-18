'use client';

import { FileText } from 'lucide-react';

interface CitationChipProps {
  sourceId: string;
  label: string;
  onOpen: (sourceId: string) => void;
}

export function CitationChip({ sourceId, label, onOpen }: CitationChipProps) {
  return (
    <button
      type="button"
      className="citation-chip"
      onClick={() => onOpen(sourceId)}
      aria-label={`Mở nguồn ${label}`}
    >
      <FileText size={13} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { MessageSquarePlus, Scale, Trash2 } from 'lucide-react';

interface CorpusEntry {
  documentId: string;
  label: string;
}

/** Short, reviewed labels for the approved decrees; official titles are too long here. */
const SHORT_LABELS: Record<string, string> = {
  'nd-157-2025': '157/2025/NĐ-CP — BHXH bắt buộc (quân nhân, công an…)',
  'nd-158-2025': '158/2025/NĐ-CP — BHXH bắt buộc',
  'nd-159-2025': '159/2025/NĐ-CP — BHXH tự nguyện',
  'nd-188-2025': '188/2025/NĐ-CP — Bảo hiểm y tế',
};

/** Shown while loading and whenever the documents API cannot be reached. */
const DEFAULT_CORPUS: readonly CorpusEntry[] = Object.entries(SHORT_LABELS).map(
  ([documentId, label]) => ({ documentId, label }),
);

type CorpusState =
  | { status: 'loading' | 'fallback'; entries: readonly CorpusEntry[] }
  | { status: 'ready'; entries: readonly CorpusEntry[] };

interface DocumentSummary {
  documentId: string;
  documentNumber: string;
  title: string;
}

function isDocumentList(value: unknown): value is { documents: DocumentSummary[] } {
  if (!value || typeof value !== 'object') return false;
  const documents = (value as { documents?: unknown }).documents;
  return (
    Array.isArray(documents) &&
    documents.every(
      (document) =>
        document &&
        typeof document === 'object' &&
        typeof (document as DocumentSummary).documentId === 'string' &&
        typeof (document as DocumentSummary).documentNumber === 'string' &&
        typeof (document as DocumentSummary).title === 'string',
    )
  );
}

function useActiveCorpus(): CorpusState {
  const [state, setState] = useState<CorpusState>({ status: 'loading', entries: DEFAULT_CORPUS });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/documents', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`documents HTTP ${response.status}`);
        const payload: unknown = await response.json();
        if (!isDocumentList(payload)) throw new Error('documents payload invalid');
        setState({
          status: 'ready',
          entries: payload.documents.map((document) => ({
            documentId: document.documentId,
            label:
              SHORT_LABELS[document.documentId] ??
              `${document.documentNumber} — ${document.title}`,
          })),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: 'fallback', entries: DEFAULT_CORPUS });
        }
      });
    return () => controller.abort();
  }, []);

  return state;
}

interface SidebarProps {
  onNewChat: () => void;
  onClearSession: () => void;
}

export function Sidebar({ onNewChat, onClearSession }: SidebarProps) {
  const corpus = useActiveCorpus();

  return (
    <nav className="sidebar" aria-label="Điều hướng">
      <div className="sidebar-brand">
        <Scale size={22} aria-hidden />
        <span>Trợ lý BHXH &amp; BHYT</span>
      </div>

      <button type="button" className="sidebar-action" onClick={onNewChat}>
        <MessageSquarePlus size={18} aria-hidden />
        Cuộc trò chuyện mới
      </button>

      <div className="sidebar-section">
        <h2 className="sidebar-heading">Phạm vi bộ dữ liệu</h2>
        {corpus.status === 'ready' && corpus.entries.length === 0 ? (
          <p className="sidebar-note">Chưa có văn bản nào đang hoạt động trong kho dữ liệu.</p>
        ) : (
          <ul
            className="corpus-list"
            aria-busy={corpus.status === 'loading'}
            data-corpus-status={corpus.status}
          >
            {corpus.entries.map((entry) => (
              <li key={entry.documentId}>{entry.label}</li>
            ))}
          </ul>
        )}
        <p className="sidebar-note">
          Chỉ tra cứu trong các văn bản trên. Không thay thế ý kiến tư vấn pháp lý chính thức.
        </p>
      </div>

      <button type="button" className="sidebar-action sidebar-action--muted" onClick={onClearSession}>
        <Trash2 size={18} aria-hidden />
        Xóa phiên
      </button>
    </nav>
  );
}

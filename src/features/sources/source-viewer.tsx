'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Copy, ExternalLink, X } from 'lucide-react';

import type { SourceViewerState } from './use-source-viewer';

export function SourceViewer({ state }: { state: SourceViewerState }) {
  const { open, close, detail, loading, error, index, order, goPrevious, goNext } = state;

  const copyCitation = () => {
    if (detail && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(`${detail.breadcrumb}\n${detail.bodyText}`);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="source-overlay" />
        <Dialog.Content className="source-panel" aria-describedby={undefined}>
          <div className="source-panel-header">
            <Dialog.Title className="source-title">
              {detail ? detail.documentNumber : 'Nguồn dẫn chiếu'}
            </Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Đóng">
              <X size={18} aria-hidden />
            </Dialog.Close>
          </div>

          {loading && (
            <p className="source-state" role="status" aria-live="polite">
              Đang tải nội dung nguồn…
            </p>
          )}
          {error && (
            <p className="source-state source-state--error" role="alert">
              {error}
            </p>
          )}

          {detail && !loading && !error && (
            <div className="source-body">
              <p className="source-breadcrumb">{detail.breadcrumb}</p>
              <p className="source-pages">
                Trang {detail.pageFrom}
                {detail.pageTo !== detail.pageFrom ? `–${detail.pageTo}` : ''}
              </p>
              <blockquote className="source-text">{detail.bodyText}</blockquote>
              <div className="source-actions">
                <button type="button" className="text-button" onClick={copyCitation}>
                  <Copy size={15} aria-hidden /> Sao chép trích dẫn
                </button>
                <a
                  className="text-button"
                  href={detail.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={15} aria-hidden /> Mở PDF đúng trang
                </a>
              </div>
            </div>
          )}

          {order.length > 1 && (
            <div className="source-nav">
              <button
                type="button"
                className="text-button"
                onClick={goPrevious}
                disabled={index === 0}
              >
                Nguồn trước
              </button>
              <span className="source-nav-count">
                {index + 1}/{order.length}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={goNext}
                disabled={index === order.length - 1}
              >
                Nguồn sau
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

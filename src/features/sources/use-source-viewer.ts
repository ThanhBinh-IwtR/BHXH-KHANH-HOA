'use client';

import { useCallback, useEffect, useState } from 'react';

import type { SourceDetail } from './types';

export interface SourceViewerState {
  open: boolean;
  order: string[];
  index: number;
  detail: SourceDetail | null;
  loading: boolean;
  error: string | null;
  openSource: (sourceId: string, order?: string[]) => void;
  close: () => void;
  goPrevious: () => void;
  goNext: () => void;
}

async function fetchSource(sourceId: string, signal: AbortSignal): Promise<SourceDetail> {
  const res = await fetch(`/api/sources/${encodeURIComponent(sourceId)}`, { signal });
  if (!res.ok) throw new Error(res.status === 404 ? 'Không tìm thấy nguồn.' : 'Không tải được nguồn.');
  return (await res.json()) as SourceDetail;
}

export function useSourceViewer(): SourceViewerState {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<SourceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentId = order[index];

  // Fetch the body only after the viewer is open and pointing at a source.
  useEffect(() => {
    if (!open || !currentId) return;
    const controller = new AbortController();
    // Kicking off an external fetch and reflecting its lifecycle in state.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    setDetail(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchSource(currentId, controller.signal)
      .then((result) => setDetail(result))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : 'Không tải được nguồn.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, currentId]);

  const openSource = useCallback((sourceId: string, nextOrder?: string[]) => {
    const list = nextOrder && nextOrder.length > 0 ? nextOrder : [sourceId];
    const found = list.indexOf(sourceId);
    setOrder(list);
    setIndex(found >= 0 ? found : 0);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  const goPrevious = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(
    () => setIndex((i) => Math.min(order.length - 1, i + 1)),
    [order.length],
  );

  return { open, order, index, detail, loading, error, openSource, close, goPrevious, goNext };
}

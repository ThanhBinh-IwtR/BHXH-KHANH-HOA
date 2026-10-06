import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '@/features/chat/components/sidebar';

function renderSidebar() {
  return render(<Sidebar onNewChat={() => {}} onClearSession={() => {}} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Sidebar corpus scope', () => {
  it('lists the documents the active corpus actually contains', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            documents: [
              { documentId: 'nd-188-2025', documentNumber: '188/2025/NĐ-CP', title: 'Nghị định 188' },
              { documentId: 'nd-200-2026', documentNumber: '200/2026/NĐ-CP', title: 'Nghị định mới' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const { container } = renderSidebar();

    await waitFor(() =>
      expect(container.querySelector('[data-corpus-status="ready"]')).not.toBeNull(),
    );
    expect(screen.getByText('188/2025/NĐ-CP — Bảo hiểm y tế')).toBeVisible();
    expect(screen.getByText('200/2026/NĐ-CP — Nghị định mới')).toBeVisible();
    expect(screen.queryByText(/157\/2025/)).toBeNull();
  });

  it('keeps the known corpus visible while loading and when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));

    const { container } = renderSidebar();
    expect(container.querySelector('.corpus-list')).toHaveAttribute('aria-busy', 'true');

    await waitFor(() =>
      expect(container.querySelector('[data-corpus-status="fallback"]')).not.toBeNull(),
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('says so when no document is active instead of showing a stale list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ documents: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderSidebar();

    expect(await screen.findByText(/chưa có văn bản nào đang hoạt động/i)).toBeVisible();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

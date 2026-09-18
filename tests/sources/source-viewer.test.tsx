import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SourceViewer } from '@/features/sources/source-viewer';
import { useSourceViewer } from '@/features/sources/use-source-viewer';

const detail = {
  sourceId: 'nd-158:d12:k3',
  documentNumber: '158/2025/NĐ-CP',
  breadcrumb: '158/2025/NĐ-CP > Điều 12 > Khoản 3',
  articleTitle: 'Mức đóng',
  bodyText: 'Người sử dụng lao động đóng 17%.',
  pageFrom: 8,
  pageTo: 8,
  pdfUrl: '/corpus/158.pdf#page=8',
};

function Harness({ id }: { id: string }) {
  const viewer = useSourceViewer();
  return (
    <>
      <button type="button" onClick={() => viewer.openSource(id, [id])}>
        open
      </button>
      <SourceViewer state={viewer} />
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('SourceViewer', () => {
  it('fetches the source body only after opening and shows verbatim text', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<Harness id="nd-158:d12:k3" />);
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() =>
      expect(screen.getByText('Người sử dụng lao động đóng 17%.')).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: /mở pdf/i })).toHaveAttribute(
      'href',
      '/corpus/158.pdf#page=8',
    );
  });

  it('shows an error message when the source is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    render(<Harness id="missing" />);
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/không tìm thấy/i));
  });

  it('closes on Escape and returns focus to the opener', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 })),
    );
    render(<Harness id="nd-158:d12:k3" />);
    const opener = screen.getByRole('button', { name: 'open' });
    await userEvent.click(opener);
    await waitFor(() => expect(screen.getByText(/đóng 17%/)).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText(/đóng 17%/)).toBeNull());
  });
});

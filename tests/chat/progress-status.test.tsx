import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgressStatus } from '@/features/chat/components/progress-status';

describe('ProgressStatus', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('shows the real pipeline stage reported by the server', () => {
    const { rerender } = render(<ProgressStatus progress="processing" stage={null} />);
    expect(screen.getByText('Hệ thống đang xử lý câu hỏi…', { selector: '.progress-line' })).toBeVisible();

    rerender(<ProgressStatus progress="processing" stage="retrieval" />);
    expect(screen.getByText('Đang tìm căn cứ phù hợp…', { selector: '.progress-line' })).toBeVisible();

    rerender(<ProgressStatus progress="processing" stage="generation" />);
    expect(
      screen.getByText('Đang soạn câu trả lời từ căn cứ…', { selector: '.progress-line' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Đang soạn câu trả lời từ căn cứ…');
  });

  it('keeps visibly counting at second 40 instead of looking frozen', () => {
    render(<ProgressStatus progress="processing" stage="generation" />);

    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.queryByText(/giây/)).toBeNull();

    act(() => vi.advanceTimersByTime(36_000));
    expect(screen.getByText(/· 40 giây/)).toBeVisible();
    expect(screen.getByText(/có thể bấm hủy/i)).toBeVisible();
  });

  it('announces to screen readers sparsely, not every second', () => {
    render(<ProgressStatus progress="processing" stage="generation" />);
    const status = screen.getByRole('status');

    act(() => vi.advanceTimersByTime(14_000));
    expect(status).toHaveTextContent(/^Đang soạn câu trả lời từ căn cứ…$/);

    act(() => vi.advanceTimersByTime(1_000));
    expect(status).toHaveTextContent('Đã chờ 15 giây.');

    act(() => vi.advanceTimersByTime(10_000));
    expect(status).toHaveTextContent('Đã chờ 15 giây.');
  });

  it('restarts the clock for a new request and cleans up when idle', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { rerender, unmount } = render(<ProgressStatus progress="processing" />);
    act(() => vi.advanceTimersByTime(12_000));
    expect(screen.getByText(/· 12 giây/)).toBeVisible();

    rerender(<ProgressStatus progress="idle" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(clearIntervalSpy).toHaveBeenCalled();

    rerender(<ProgressStatus progress="processing" />);
    expect(screen.queryByText(/giây/)).toBeNull();
    unmount();
  });
});

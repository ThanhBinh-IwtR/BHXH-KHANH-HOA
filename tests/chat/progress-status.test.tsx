import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgressStatus } from '@/features/chat/components/progress-status';

describe('ProgressStatus', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('rotates messages every four seconds and stops at the final message', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { rerender, unmount } = render(<ProgressStatus progress="processing" />);

    expect(screen.getByText('Đang tiếp nhận câu hỏi…')).toBeVisible();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText('Đang phân tích nội dung…')).toBeVisible();

    act(() => vi.advanceTimersByTime(5 * 4000));
    expect(screen.getByText('Đang hoàn thiện câu trả lời…')).toBeVisible();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText('Đang hoàn thiện câu trả lời…')).toBeVisible();

    expect(screen.getByRole('status')).toHaveTextContent('Hệ thống đang xử lý câu hỏi');
    rerender(<ProgressStatus progress="idle" />);
    expect(screen.queryByText('Đang hoàn thiện câu trả lời…')).toBeNull();
    expect(clearIntervalSpy).toHaveBeenCalled();

    unmount();
  });
});

import { useEffect, useState } from 'react';

import type { ChatProgress } from '../chat-types';

const PROGRESS_MESSAGES = [
  'Đang tiếp nhận câu hỏi…',
  'Đang phân tích nội dung…',
  'Đang tìm căn cứ phù hợp…',
  'Đang đối chiếu các quy định…',
  'Đang kiểm tra độ chính xác…',
  'Đang hoàn thiện câu trả lời…',
] as const;

const PROGRESS_INTERVAL_MS = 4_000;

export function ProgressStatus({ progress }: { progress: ChatProgress }) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (progress === 'idle') {
      // A new request must always start from the first visible message.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessageIndex(0);
      return;
    }

    // A new processing period (including retry) gets a fresh message cycle.
    setMessageIndex(0);
    const timer = setInterval(() => {
      setMessageIndex((current) => Math.min(current + 1, PROGRESS_MESSAGES.length - 1));
    }, PROGRESS_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [progress]);

  if (progress === 'idle') return null;
  return (
    <div className="progress-status">
      <span className="progress-spinner" aria-hidden />
      <span aria-hidden="true">{PROGRESS_MESSAGES[messageIndex]}</span>
      <span className="sr-only" role="status" aria-live="polite">
        Hệ thống đang xử lý câu hỏi
      </span>
    </div>
  );
}

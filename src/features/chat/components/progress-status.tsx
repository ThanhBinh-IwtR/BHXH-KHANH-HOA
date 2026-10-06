import { useEffect, useState } from 'react';

import type { ChatProgress, ChatStage } from '../chat-types';

/** Labels for the real pipeline milestones streamed by the server. */
const STAGE_MESSAGES: Record<ChatStage, string> = {
  retrieval: 'Đang tìm căn cứ phù hợp…',
  context: 'Đang đối chiếu các quy định liên quan…',
  generation: 'Đang soạn câu trả lời từ căn cứ…',
  verification: 'Đang kiểm tra căn cứ của câu trả lời…',
};

/** Shown before the first milestone arrives, or when the server does not stream. */
const WAITING_MESSAGE = 'Hệ thống đang xử lý câu hỏi…';
const ELAPSED_VISIBLE_AFTER_S = 5;
const CANCEL_HINT_AFTER_S = 20;
/** Screen readers hear the stage changes plus one update per interval, never every second. */
const ANNOUNCE_INTERVAL_S = 15;

export function ProgressStatus({
  progress,
  stage = null,
}: {
  progress: ChatProgress;
  stage?: ChatStage | null;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    // Every processing period (including a retry) starts its own clock.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsedSeconds(0);
    if (progress === 'idle') return;
    const timer = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1_000);
    return () => clearInterval(timer);
  }, [progress]);

  if (progress === 'idle') return null;

  const message = stage ? STAGE_MESSAGES[stage] : WAITING_MESSAGE;
  const announcedSeconds =
    Math.floor(elapsedSeconds / ANNOUNCE_INTERVAL_S) * ANNOUNCE_INTERVAL_S;
  const announcement =
    announcedSeconds > 0 ? `${message} Đã chờ ${announcedSeconds} giây.` : message;

  return (
    <div className="progress-status">
      <span className="progress-spinner" aria-hidden />
      <span className="progress-text" aria-hidden="true">
        <span className="progress-line">
          {message}
          {elapsedSeconds >= ELAPSED_VISIBLE_AFTER_S && (
            <span className="progress-elapsed"> · {elapsedSeconds} giây</span>
          )}
        </span>
        <span className="progress-hint">
          {elapsedSeconds >= CANCEL_HINT_AFTER_S ? 'Bạn có thể bấm Hủy để dừng yêu cầu.' : ''}
        </span>
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

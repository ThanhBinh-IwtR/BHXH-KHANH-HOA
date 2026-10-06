'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';

import type { ChatProgress } from '../chat-types';

interface ChatComposerProps {
  onSend: (message: string) => void;
  onCancel: () => void;
  progress: ChatProgress;
}

export function ChatComposer({ onSend, onCancel, progress }: ChatComposerProps) {
  const [value, setValue] = useState('');
  const busy = progress !== 'idle';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setValue('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // While a request runs the draft is kept; it can be sent once it finishes.
      if (!busy) submit(event);
    }
  };

  return (
    <form className="composer" onSubmit={submit} aria-label="Ô nhập câu hỏi">
      <label htmlFor="chat-input" className="sr-only">
        Nhập câu hỏi về BHXH hoặc BHYT
      </label>
      <textarea
        id="chat-input"
        className="composer-input"
        placeholder="Nhập câu hỏi về BHXH/BHYT…"
        value={value}
        rows={1}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        // Never `disabled`: disabling the focused field would drop keyboard
        // focus to <body> for the whole 20-50 s wait. Submission is blocked
        // instead, and the next question can already be drafted.
        aria-describedby={busy ? 'chat-input-busy' : undefined}
      />
      {busy && (
        <span id="chat-input-busy" className="sr-only">
          Đang xử lý câu hỏi trước; có thể soạn tiếp câu hỏi mới và gửi khi hoàn tất.
        </span>
      )}
      {busy ? (
        <button type="button" className="composer-button" onClick={onCancel} aria-label="Hủy yêu cầu">
          <Square size={18} aria-hidden />
        </button>
      ) : (
        <button
          type="submit"
          className="composer-button"
          disabled={!value.trim()}
          aria-label="Gửi câu hỏi"
        >
          <Send size={18} aria-hidden />
        </button>
      )}
    </form>
  );
}

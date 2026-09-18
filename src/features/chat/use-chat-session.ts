'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { PublicResponse } from '@/features/legal-rag/public-response';

import {
  MAX_HISTORY_TURNS,
  MAX_STORED_MESSAGES,
  SESSION_STORAGE_KEY,
  type ChatMessage,
  type ChatProgress,
} from './chat-types';

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ChatSession {
  messages: ChatMessage[];
  progress: ChatProgress;
  error: string | null;
  send: (message: string) => Promise<void>;
  retry: () => Promise<void>;
  cancel: () => void;
  newChat: () => void;
  clearSession: () => void;
  restore: (messages: ChatMessage[]) => void;
}

interface HistoryTurn {
  role: ChatMessage['role'];
  content: string;
}

interface PendingRequest {
  message: string;
  history: HistoryTurn[];
}

interface SubmitOptions {
  appendUserMessage?: boolean;
}

function isPublicResponse(value: unknown): value is PublicResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PublicResponse>;
  return (
    typeof candidate.shortAnswer === 'string' &&
    ['grounded', 'partial', 'needs_clarification', 'out_of_scope'].includes(
      candidate.scopeStatus ?? '',
    ) &&
    Array.isArray(candidate.analysis) &&
    Array.isArray(candidate.sources)
  );
}

export function useChatSession(): ChatSession {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [progress, setProgress] = useState<ChatProgress>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRequestRef = useRef<PendingRequest | null>(null);

  // Hydrate from sessionStorage (never localStorage) on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as ChatMessage[];
        // One-time hydration from the sessionStorage external store.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(parsed)) setMessages(parsed.slice(-MAX_STORED_MESSAGES));
      } catch {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  }, []);

  // Persist to sessionStorage only.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (messages.length === 0) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  }, [messages]);

  const submit = useCallback(
    async (
      message: string,
      history: HistoryTurn[],
      { appendUserMessage = true }: SubmitOptions = {},
    ) => {
      if (!message || progress !== 'idle') return;
      setError(null);
      pendingRequestRef.current = { message, history };

      if (appendUserMessage) {
        const userMessage: ChatMessage = { id: newId(), role: 'user', content: message };
        setMessages((current) => [...current, userMessage]);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setProgress('processing');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, history }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const status = res.status;
          let serverMessage: string | null = null;
          try {
            const payload = (await res.clone().json()) as {
              error?: { message?: unknown };
            };
            if (typeof payload.error?.message === 'string') serverMessage = payload.error.message;
          } catch {
            // Keep the stable client-side fallback below for empty/non-JSON responses.
          }
          throw new Error(
            serverMessage ??
            (status === 429
              ? 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.'
              : status === 504
                ? 'Dịch vụ AI chưa phản hồi trong thời gian cho phép. Vui lòng thử lại sau.'
                : status === 503
                ? 'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.'
                : 'Đã xảy ra lỗi khi xử lý câu hỏi.'),
          );
        }
        const answer: unknown = await res.json();
        if (!isPublicResponse(answer)) {
          throw new Error('Phản hồi từ máy chủ không hợp lệ. Vui lòng thử lại.');
        }
        setMessages((current) => [
          ...current,
          {
            id: newId(),
            role: 'assistant',
            content: answer.shortAnswer,
            answer,
            status: 'complete',
          },
        ]);
        pendingRequestRef.current = null;
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(toUserError(caught));
      } finally {
        setProgress('idle');
        abortRef.current = null;
      }
    },
    [progress],
  );

  const send = useCallback(
    (raw: string) => {
      const message = raw.trim();
      if (!message || progress !== 'idle') return Promise.resolve();
      const history = messages
        .slice(-MAX_HISTORY_TURNS * 2)
        .map((entry) => ({ role: entry.role, content: entry.content }));
      return submit(message, history);
    },
    [messages, progress, submit],
  );

  const retry = useCallback(() => {
    const pending = pendingRequestRef.current;
    if (!pending || progress !== 'idle') return Promise.resolve();
    return submit(pending.message, pending.history, { appendUserMessage: false });
  }, [progress, submit]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    pendingRequestRef.current = null;
    setError(null);
    setProgress('idle');
  }, []);

  const newChat = useCallback(() => {
    cancel();
    setError(null);
    setMessages([]);
  }, [cancel]);

  const clearSession = useCallback(() => {
    cancel();
    setError(null);
    setMessages([]);
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }, [cancel]);

  const restore = useCallback((restored: ChatMessage[]) => {
    setMessages(restored.slice(-MAX_STORED_MESSAGES));
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { messages, progress, error, send, retry, cancel, newChat, clearSession, restore };
}

function toUserError(error: unknown): string {
  if (error instanceof TypeError && /fetch|network|connection/i.test(error.message)) {
    return 'Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng và thử lại.';
  }
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.';
}

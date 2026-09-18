import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatSession } from '@/features/chat/use-chat-session';

const grounded = {
  scopeStatus: 'grounded',
  shortAnswer: 'Tỷ lệ đóng là 17%.',
  analysis: [],
  aiSupplement: null,
  missingInformation: [],
  followUpQuestion: null,
  sources: [],
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useChatSession', () => {
  it('persists messages only in sessionStorage', () => {
    const { result } = renderHook(() => useChatSession());
    act(() => {
      result.current.restore([{ id: '1', role: 'user', content: 'Câu hỏi' }]);
    });
    expect(sessionStorage.getItem('legal-chat-session')).toContain('Câu hỏi');
    expect(localStorage.getItem('legal-chat-session')).toBeNull();
  });

  it('appends a verified assistant answer after send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(grounded), { status: 200 })),
    );
    const { result } = renderHook(() => useChatSession());
    await act(async () => {
      await result.current.send('Câu hỏi về tỷ lệ đóng');
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[1].role).toBe('assistant');
    expect(result.current.messages[1].answer?.shortAnswer).toBe('Tỷ lệ đóng là 17%.');
    expect(result.current.progress).toBe('idle');
  });

  it('surfaces a friendly error on a 503 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 })),
    );
    const { result } = renderHook(() => useChatSession());
    await act(async () => {
      await result.current.send('Câu hỏi');
    });
    await waitFor(() => expect(result.current.error).toMatch(/không khả dụng/i));
  });

  it('maps a browser network failure to a retryable Vietnamese message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useChatSession());

    await act(async () => {
      await result.current.send('Câu hỏi khi mất mạng');
    });

    await waitFor(() => expect(result.current.error).toMatch(/kết nối|mạng|thử lại/i));
    expect(result.current.error).not.toBe('Failed to fetch');
  });

  it('keeps one truthful processing state and cancel inserts no assistant message', async () => {
    let rejectRequest!: (error: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_input: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const { result } = renderHook(() => useChatSession());
    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.send('Câu hỏi chờ xử lý');
    });
    await waitFor(() => expect(result.current.progress).toBe('processing'));
    expect(result.current.progress).not.toBe('retrieving');
    expect(result.current.progress).not.toBe('verifying');

    act(() => result.current.cancel());
    rejectRequest(new DOMException('Aborted', 'AbortError'));
    await act(async () => {
      await sendPromise;
    });

    expect(result.current.progress).toBe('idle');
    expect(result.current.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
  });

  it('retries the retained failed question with the original bounded history', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(grounded), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChatSession());

    await act(async () => {
      await result.current.send('Câu hỏi cần thử lại');
    });
    await waitFor(() => expect(result.current.error).toMatch(/không khả dụng/i));

    await act(async () => {
      await result.current.retry();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({ message: 'Câu hỏi cần thử lại', history: [] }),
    );
    expect(result.current.error).toBeNull();
    expect(result.current.messages.some((message) => message.answer)).toBe(true);
    expect(result.current.messages.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  it('rejects a malformed successful response without inserting an assistant message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const { result } = renderHook(() => useChatSession());

    await act(async () => {
      await result.current.send('Câu hỏi malformed');
    });

    expect(result.current.error).toMatch(/phản hồi.*không hợp lệ/i);
    expect(result.current.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
  });

  it('clears all messages and storage on clearSession', async () => {
    const { result } = renderHook(() => useChatSession());
    act(() => result.current.restore([{ id: '1', role: 'user', content: 'X' }]));
    act(() => result.current.clearSession());
    expect(result.current.messages).toHaveLength(0);
    expect(sessionStorage.getItem('legal-chat-session')).toBeNull();
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatSession } from '@/features/chat/use-chat-session';

const grounded = {
  scopeStatus: 'grounded',
  shortAnswer: 'Tỷ lệ đóng là 17%.',
  analysis: [],
  missingInformation: [],
  followUpQuestion: null,
  sources: [],
};

function sseBlock(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

/** Build a text/event-stream response that yields the given blocks one by one. */
function eventStream(blocks: string[], gate?: Promise<void>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const [index, block] of blocks.entries()) {
        if (index === blocks.length - 1 && gate) await gate;
        controller.enqueue(encoder.encode(block));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

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

  it('shows real stages from the event stream, then appends the streamed answer', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const generation = sseBlock('stage', '{"stage":"generation"}');
    const fetchMock = vi.fn().mockResolvedValue(
      eventStream(
        [
          sseBlock('stage', '{"stage":"retrieval"}'),
          // A block may arrive split across network chunks.
          generation.slice(0, 20),
          generation.slice(20),
          sseBlock('result', JSON.stringify(grounded)),
        ],
        gate,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChatSession());

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.send('Câu hỏi có tiến trình thật');
    });
    await waitFor(() => expect(result.current.stage).toBe('generation'));
    expect(result.current.progress).toBe('processing');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      accept: expect.stringContaining('text/event-stream'),
    });

    release();
    await act(async () => {
      await sendPromise;
    });
    expect(result.current.stage).toBeNull();
    expect(result.current.progress).toBe('idle');
    expect(result.current.messages[1].answer?.shortAnswer).toBe('Tỷ lệ đóng là 17%.');
  });

  it('surfaces a streamed server error with its message and keeps retry available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        eventStream([
          sseBlock('stage', '{"stage":"generation"}'),
          sseBlock(
            'error',
            '{"code":"output_truncated","message":"Câu trả lời vượt quá độ dài cho phép.","status":502}',
          ),
        ]),
      ),
    );
    const { result } = renderHook(() => useChatSession());

    await act(async () => {
      await result.current.send('Câu hỏi quá dài');
    });

    expect(result.current.error).toBe('Câu trả lời vượt quá độ dài cho phép.');
    expect(result.current.messages.filter((message) => message.role === 'assistant')).toHaveLength(0);
  });

  it('reports an interrupted stream instead of waiting forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(eventStream([sseBlock('stage', '{"stage":"retrieval"}')])),
    );
    const { result } = renderHook(() => useChatSession());

    await act(async () => {
      await result.current.send('Câu hỏi bị ngắt');
    });

    expect(result.current.error).toMatch(/gián đoạn/i);
  });

  it('starts only one request when send is called twice in the same tick', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(grounded), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChatSession());

    await act(async () => {
      await Promise.all([result.current.send('Câu hỏi A'), result.current.send('Câu hỏi B')]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  it('does not let a cancelled request reset the state of the next one', async () => {
    let finishSecond!: () => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        (_input: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () =>
              // The first request settles late, after the second one started.
              setTimeout(() => reject(new DOMException('Aborted', 'AbortError')), 20),
            ),
          ),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSecond = () => resolve(new Response(JSON.stringify(grounded), { status: 200 }));
          }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useChatSession());

    let first!: Promise<void>;
    act(() => {
      first = result.current.send('Câu hỏi bị hủy');
    });
    await waitFor(() => expect(result.current.progress).toBe('processing'));
    act(() => result.current.cancel());
    let second!: Promise<void>;
    act(() => {
      second = result.current.send('Câu hỏi mới');
    });
    await act(async () => {
      await first;
    });

    expect(result.current.progress).toBe('processing');
    finishSecond();
    await act(async () => {
      await second;
    });
    expect(result.current.progress).toBe('idle');
    expect(result.current.messages.filter((message) => message.answer)).toHaveLength(1);
  });
});

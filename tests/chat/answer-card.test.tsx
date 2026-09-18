import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AnswerCard } from '@/features/chat/components/answer-card';
import type { PublicResponse } from '@/features/legal-rag/public-response';

const groundedAnswer: PublicResponse = {
  scopeStatus: 'grounded',
  shortAnswer: 'Người sử dụng lao động đóng 17%.',
  shortAnswerCitations: [
    { sourceId: 'nd-158:d12:k3', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' },
  ],
  analysis: [
    {
      claim: 'Tỷ lệ đóng vào quỹ hưu trí và tử tuất là 17%.',
      citations: [{ sourceId: 'nd-158:d12:k3', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' }],
    },
  ],
  aiSupplement: 'Giải thích thêm về quỹ hưu trí.',
  missingInformation: [],
  followUpQuestion: null,
  sources: [
    {
      sourceId: 'nd-158:d12:k3',
      label: '158/2025/NĐ-CP · Điều 12 · Khoản 3',
      documentNumber: '158/2025/NĐ-CP',
      pageFrom: 8,
      pageTo: 8,
    },
  ],
};

describe('AnswerCard', () => {
  it('renders grounded citations as buttons with a full accessible name', () => {
    render(<AnswerCard answer={groundedAnswer} onOpenSource={() => {}} />);
    const chips = screen.getAllByRole('button', {
      name: /mở nguồn 158\/2025\/NĐ-CP · Điều 12 · Khoản 3/i,
    });
    expect(chips.length).toBeGreaterThan(0);
  });

  it('shows a concise AI accuracy notice and the source page on citations', () => {
    render(<AnswerCard answer={groundedAnswer} onOpenSource={() => {}} />);
    expect(screen.getByRole('note')).toHaveTextContent(/có thể có sai sót/i);
    expect(screen.getAllByRole('button', { name: /trang 8/i })).toHaveLength(1);
  });

  it('renders a deeper grounded answer as separate analysis sections', () => {
    render(
      <AnswerCard
        answer={{
          ...groundedAnswer,
          analysis: [
            groundedAnswer.analysis[0],
            {
              claim: 'Điều kiện và đối tượng áp dụng được xác định theo nội dung của nguồn.',
              citations: [{ sourceId: 'nd-158:d12:k3', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' }],
            },
            {
              claim: 'Cách áp dụng cần đối chiếu đúng nhóm đối tượng và căn cứ được nêu.',
              citations: [{ sourceId: 'nd-158:d12:k3', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' }],
            },
          ],
        }}
        onOpenSource={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Quy định chính' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Điều kiện và đối tượng' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Cách áp dụng' })).toBeVisible();
    expect(screen.getByText(/Điều kiện và đối tượng áp dụng/)).toBeVisible();
  });

  it('renders one citation when the same document location is repeated across the answer', () => {
    render(
      <AnswerCard
        answer={{
          ...groundedAnswer,
          analysis: [
            groundedAnswer.analysis[0],
            {
              claim: 'Căn cứ tính vẫn là tiền lương được nêu trong cùng vị trí pháp lý.',
              citations: [
                {
                  sourceId: 'nd-158:d12:k3-duplicate',
                  label: '158/2025/NĐ-CP · Điều 12 · Khoản 3',
                },
              ],
            },
            {
              claim: 'Khi đối chiếu, mở đúng văn bản tại cùng vị trí này.',
              citations: [{ sourceId: 'nd-158:d12:k3', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' }],
            },
          ],
          sources: [
            ...groundedAnswer.sources,
            {
              sourceId: 'nd-158:d12:k3-duplicate',
              label: '158/2025/NĐ-CP · Điều 12 · Khoản 3',
              documentNumber: '158/2025/NĐ-CP',
              pageFrom: 8,
              pageTo: 8,
            },
          ],
        }}
        onOpenSource={() => {}}
      />,
    );

    expect(
      screen.getAllByRole('button', { name: /mở nguồn 158\/2025\/NĐ-CP · Điều 12 · Khoản 3/i }),
    ).toHaveLength(1);
  });

  it('keeps citations when the legal document location is different', () => {
    render(
      <AnswerCard
        answer={{
          ...groundedAnswer,
          analysis: [
            groundedAnswer.analysis[0],
            {
              claim: 'Một lần nhắc lại cùng căn cứ không tạo thêm chip.',
              citations: [{ sourceId: 'nd-158:d12:k3', label: '158/2025/NĐ-CP · Điều 12 · Khoản 3' }],
            },
            {
              claim: 'Vị trí khoản khác vẫn cần một citation riêng.',
              citations: [{ sourceId: 'nd-158:d12:k4', label: '158/2025/NĐ-CP · Điều 12 · Khoản 4' }],
            },
          ],
          sources: [
            ...groundedAnswer.sources,
            {
              sourceId: 'nd-158:d12:k4',
              label: '158/2025/NĐ-CP · Điều 12 · Khoản 4',
              documentNumber: '158/2025/NĐ-CP',
              pageFrom: 9,
              pageTo: 9,
            },
          ],
        }}
        onOpenSource={() => {}}
      />,
    );

    expect(screen.getAllByRole('button', { name: /mở nguồn/i })).toHaveLength(2);
  });

  it('never shows similarity or fusion scores', () => {
    const { container } = render(<AnswerCard answer={groundedAnswer} onOpenSource={() => {}} />);
    expect(container.textContent).not.toMatch(/score|similarity|0\.\d+/i);
  });

  it('does not render the unverified supplement or a repeated source list', () => {
    render(<AnswerCard answer={groundedAnswer} onOpenSource={() => {}} />);
    expect(screen.queryByText(/nguồn đã dùng/i)).toBeNull();
    expect(screen.queryByText(/ai bổ sung/i)).toBeNull();
    expect(screen.queryByText('Giải thích thêm về quỹ hưu trí.')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: /mở nguồn 158\/2025\/NĐ-CP · Điều 12 · Khoản 3/i }),
    ).toHaveLength(1);
  });

  it('invokes onOpenSource with the full source order when a citation is clicked', async () => {
    const onOpen = vi.fn();
    render(<AnswerCard answer={groundedAnswer} onOpenSource={onOpen} />);
    await userEvent.click(
      screen.getAllByRole('button', { name: /mở nguồn/i })[0],
    );
    expect(onOpen).toHaveBeenCalledWith('nd-158:d12:k3', ['nd-158:d12:k3']);
  });

  it('does not render a legal conclusion list for a clarification answer', () => {
    render(
      <AnswerCard
        answer={{
          ...groundedAnswer,
          scopeStatus: 'needs_clarification',
          analysis: [{ claim: 'Không nên hiển thị', citations: [] }],
        }}
        onOpenSource={() => {}}
      />,
    );
    expect(screen.queryByText('Không nên hiển thị')).toBeNull();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '@/features/chat/components/chat-composer';

describe('ChatComposer', () => {
  it('sends on Enter and clears the field', async () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onCancel={() => {}} progress="idle" />);
    const input = screen.getByLabelText(/nhập câu hỏi về bhxh/i);
    await userEvent.type(input, 'Câu hỏi thử{Enter}');
    expect(onSend).toHaveBeenCalledWith('Câu hỏi thử');
    expect(input).toHaveValue('');
  });

  it('does not send on Shift+Enter', async () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} onCancel={() => {}} progress="idle" />);
    const input = screen.getByLabelText(/nhập câu hỏi về bhxh/i);
    await userEvent.type(input, 'Dòng 1{Shift>}{Enter}{/Shift}Dòng 2');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows a cancel control while a request is in progress', async () => {
    const onCancel = vi.fn();
    render(<ChatComposer onSend={() => {}} onCancel={onCancel} progress="processing" />);
    const cancel = screen.getByRole('button', { name: /hủy yêu cầu/i });
    await userEvent.click(cancel);
    expect(onCancel).toHaveBeenCalled();
  });
});

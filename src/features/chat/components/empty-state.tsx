'use client';

import { ShieldQuestion } from 'lucide-react';

export const EXAMPLE_QUESTIONS = [
  'Người sử dụng lao động đóng bao nhiêu phần trăm vào quỹ hưu trí và tử tuất theo Nghị định 158/2025/NĐ-CP?',
  'Mức đóng bảo hiểm xã hội tự nguyện hằng tháng được tính như thế nào?',
  'khoản 3 Điều 12 Nghị định 158/2025/NĐ-CP quy định gì?',
  'Mức đóng bảo hiểm y tế hằng tháng là bao nhiêu?',
];

interface EmptyStateProps {
  onExample: (question: string) => void;
}

export function EmptyState({ onExample }: EmptyStateProps) {
  return (
    <section className="empty-state" aria-label="Giới thiệu trợ lý">
      <ShieldQuestion size={40} aria-hidden className="empty-state-icon" />
      <h2>Trợ lý tra cứu BHXH &amp; BHYT</h2>
      <p>
        Trợ lý phân tích quy định dựa trên bốn nghị định trong bộ dữ liệu demo. Mọi kết luận đều
        kèm nguồn có thể mở và kiểm tra lại. Đây không phải toàn bộ hệ thống pháp luật BHXH/BHYT.
      </p>
      <ul className="example-list">
        {EXAMPLE_QUESTIONS.map((question) => (
          <li key={question}>
            <button type="button" className="example-button" onClick={() => onExample(question)}>
              {question}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

'use client';

import { MessageSquarePlus, Scale, Trash2 } from 'lucide-react';

const CORPUS = [
  '157/2025/NĐ-CP — BHXH bắt buộc (quân nhân, công an…)',
  '158/2025/NĐ-CP — BHXH bắt buộc',
  '159/2025/NĐ-CP — BHXH tự nguyện',
  '188/2025/NĐ-CP — Bảo hiểm y tế',
];

interface SidebarProps {
  onNewChat: () => void;
  onClearSession: () => void;
}

export function Sidebar({ onNewChat, onClearSession }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Điều hướng">
      <div className="sidebar-brand">
        <Scale size={22} aria-hidden />
        <span>Trợ lý BHXH &amp; BHYT</span>
      </div>

      <button type="button" className="sidebar-action" onClick={onNewChat}>
        <MessageSquarePlus size={18} aria-hidden />
        Cuộc trò chuyện mới
      </button>

      <div className="sidebar-section">
        <h2 className="sidebar-heading">Phạm vi bộ dữ liệu</h2>
        <ul className="corpus-list">
          {CORPUS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="sidebar-note">
          Chỉ tra cứu trong bốn nghị định trên. Không thay thế ý kiến tư vấn pháp lý chính thức.
        </p>
      </div>

      <button type="button" className="sidebar-action sidebar-action--muted" onClick={onClearSession}>
        <Trash2 size={18} aria-hidden />
        Xóa phiên
      </button>
    </nav>
  );
}

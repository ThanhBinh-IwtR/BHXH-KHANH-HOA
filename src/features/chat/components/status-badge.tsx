import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';

import type { ScopeStatus } from '@/features/legal-rag/types';

const CONFIG: Record<ScopeStatus, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  grounded: { label: 'Đủ căn cứ trong bộ tài liệu', icon: CheckCircle2, tone: 'grounded' },
  partial: { label: 'Có căn cứ một phần', icon: AlertTriangle, tone: 'partial' },
  needs_clarification: { label: 'Cần thêm thông tin', icon: HelpCircle, tone: 'clarify' },
  out_of_scope: { label: 'Ngoài phạm vi tài liệu', icon: XCircle, tone: 'oos' },
};

export function StatusBadge({ status }: { status: ScopeStatus }) {
  const { label, icon: Icon, tone } = CONFIG[status];
  return (
    <span className={`status-badge status-badge--${tone}`} data-status={status}>
      <Icon size={16} aria-hidden />
      {/* Icon + text: colour alone never conveys the status. */}
      <span>{label}</span>
    </span>
  );
}

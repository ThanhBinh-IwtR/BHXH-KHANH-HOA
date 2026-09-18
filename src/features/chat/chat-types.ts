import type { PublicResponse } from '@/features/legal-rag/public-response';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  answer?: PublicResponse;
  status?: 'complete' | 'error';
}

export type ChatProgress = 'idle' | 'processing';

export const SESSION_STORAGE_KEY = 'legal-chat-session';
export const MAX_STORED_MESSAGES = 30;
export const MAX_HISTORY_TURNS = 6;

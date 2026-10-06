'use client';

import { useEffect, useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';

import { SourceViewer } from '@/features/sources/source-viewer';
import { useSourceViewer } from '@/features/sources/use-source-viewer';

import { useChatSession } from '../use-chat-session';
import { AnswerCard } from './answer-card';
import { AgencyBrand } from './agency-brand';
import { ChatComposer } from './chat-composer';
import { EmptyState } from './empty-state';
import { ProgressStatus } from './progress-status';
import { Sidebar } from './sidebar';

export function AppShell() {
  const session = useChatSession();
  const viewer = useSourceViewer();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [session.messages, session.progress]);

  const handleExample = (question: string) => {
    setDrawerOpen(false);
    void session.send(question);
  };

  return (
    <div className="app-shell">
      <aside className={drawerOpen ? 'sidebar-wrap sidebar-wrap--open' : 'sidebar-wrap'}>
        <Sidebar
          onNewChat={() => {
            session.newChat();
            setDrawerOpen(false);
          }}
          onClearSession={() => {
            session.clearSession();
            setDrawerOpen(false);
          }}
        />
      </aside>
      {drawerOpen && (
        <button
          type="button"
          className="drawer-scrim"
          aria-label="Đóng menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <main className="chat-main">
        <header className="chat-header">
          <button
            type="button"
            className="icon-button menu-button"
            aria-label={drawerOpen ? 'Đóng menu' : 'Mở menu'}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {drawerOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
          <AgencyBrand variant="header" />
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          <div className="chat-column">
            {session.messages.length === 0 && <EmptyState onExample={handleExample} />}

            {session.messages.map((message) =>
              message.role === 'user' ? (
                <div key={message.id} className="user-bubble">
                  {message.content}
                </div>
              ) : message.answer ? (
                <AnswerCard
                  key={message.id}
                  answer={message.answer}
                  onOpenSource={(id, order) => viewer.openSource(id, order)}
                />
              ) : null,
            )}

            <ProgressStatus progress={session.progress} stage={session.stage} />

            {session.error && (
              <div className="error-banner" role="alert">
                <X size={16} aria-hidden />
                <span>{session.error}</span>
                <button type="button" className="text-button" onClick={() => void session.retry()}>
                  Thử lại câu hỏi
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="composer-wrap">
          <div className="chat-column">
            <ChatComposer
              onSend={(message) => session.send(message)}
              onCancel={session.cancel}
              progress={session.progress}
            />
          </div>
        </div>
      </main>

      <SourceViewer state={viewer} />
    </div>
  );
}

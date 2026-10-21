import { useEffect, useState } from 'react';
import type { DomainContextValue } from '../../domains/DomainRegistry';
import type { ActiveView } from '../workspace/Sidebar';
import { logger } from '../../utils/logger';

export interface ThreadSwitcherParams {
  createThread: DomainContextValue['createThread'];
  threadRegistry: DomainContextValue['threadRegistry'];
  setActiveView: (view: ActiveView) => void;
}

// Quick switcher open-state + the Cmd/Ctrl+K/N/Shift+A shortcuts.
export function useThreadSwitcher(params: ThreadSwitcherParams) {
  const { createThread, threadRegistry, setActiveView } = params;

  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'k') {
        e.preventDefault();
        setIsSwitcherOpen((v) => !v);
      } else if (k === 'n' && !e.shiftKey) {
        e.preventDefault();
        createThread();
        setActiveView('chat');
      } else if (k === 'a' && e.shiftKey) {
        e.preventDefault();
        const id = threadRegistry.getActiveThreadId();
        const t = threadRegistry.getThread(id);
        if (t) {
          const next = t.lifecycle === 'archived' ? 'active' : 'archived';
          logger.action('App', `Shortcut archive toggle → ${next}`, { threadId: id });
          threadRegistry.setThreadLifecycle(id, next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createThread, threadRegistry]);

  return { isSwitcherOpen, setIsSwitcherOpen };
}

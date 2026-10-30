/**
 * The LAW-4 composer draft store: the unsent draft lives here, keyed by
 * thread, restored from and saved to mode-scoped storage.
 */
import { useEffect, useState } from 'react';
import {
  loadComposerDrafts,
  registerComposerDraftFlush,
  scheduleComposerDraftSave,
} from './composerDrafts';

export function useComposerDrafts(activeThreadId: string) {
  // LAW 4: the unsent draft lives HERE, keyed by thread. ChatView unmounts
  // when [+ Attach] opens the library; the query must survive that trip.
  // AND it survives the page: restored from mode-scoped storage, saved
  // debounced on every change, flushed when the page hides or unloads
  // (composerDrafts.ts) — a phone killing the browser must not eat the text.
  const [draftByThread, setDraftByThread] = useState<Record<string, string>>(() => loadComposerDrafts());
  const draftText = draftByThread[activeThreadId] ?? '';
  const handleDraftTextChange = (text: string) => {
    setDraftByThread((prev) => ({ ...prev, [activeThreadId]: text }));
  };
  // Persist on every change (debounced inside scheduleComposerDraftSave).
  // The effect sees the latest state, so no stale-closure races on fast typing.
  useEffect(() => {
    scheduleComposerDraftSave(draftByThread);
  }, [draftByThread]);
  // Mobile browsers kill pages without beforeunload — pagehide and
  // visibilitychange→hidden are the hooks that do arrive.
  useEffect(() => registerComposerDraftFlush(), []);

  return { draftText, handleDraftTextChange };
}

/**
 * How chat bubbles are displayed by default: rendered markdown or raw source.
 *
 * A reading preference, not project data — it belongs to this browser, so it
 * lives in localStorage alongside the backend choice, never in the workspace.
 * 'markdown' is the default and is therefore stored as *absence* of the key.
 */
export type ChatRenderMode = 'markdown' | 'raw';

const KEY = 'markbrain:chatRender';

export function parseChatRenderMode(stored: string | null | undefined): ChatRenderMode {
  return stored === 'raw' ? 'raw' : 'markdown';
}

/**
 * Which view one bubble shows. A bubble only gains an entry when you flip it
 * by hand; until then it follows the global switch — that is what makes the
 * switch total instead of half-applied.
 */
export function messageIsRaw(
  overrides: Record<string, boolean>,
  messageId: string,
  mode: ChatRenderMode
): boolean {
  return overrides[messageId] ?? mode === 'raw';
}

/** Flip one bubble to its other view, recording it as an explicit choice. */
export function flipMessageView(
  overrides: Record<string, boolean>,
  messageId: string,
  mode: ChatRenderMode
): Record<string, boolean> {
  return { ...overrides, [messageId]: !messageIsRaw(overrides, messageId, mode) };
}

export function loadChatRenderMode(): ChatRenderMode {
  try {
    return parseChatRenderMode(window.localStorage.getItem(KEY));
  } catch {
    return 'markdown';
  }
}

export function saveChatRenderMode(mode: ChatRenderMode): void {
  try {
    if (mode === 'markdown') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, mode);
  } catch {
    // Private mode / storage disabled — the in-memory choice still applies
    // for this session, which is better than dropping the click.
  }
}

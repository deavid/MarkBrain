/**
 * Whether a bare Enter sends the message or inserts a new line.
 *
 * A typing preference, not project data — it belongs to this browser, so it
 * lives in localStorage alongside the bubble-view and backend choices, never
 * in the workspace.
 *
 * Two rules sit OUTSIDE this preference and are never configurable, because a
 * silent violation of either is a lost message or a broken line:
 *
 *   Shift+Enter  NEVER sends  — it always makes a new line.
 *   Ctrl/Cmd+Enter ALWAYS sends — the one chording that works on every keyboard.
 *
 * Only the bare Enter key is what this switch governs. 'send' is the default
 * and is therefore stored as *absence* of the key.
 */
export type EnterSendMode = 'send' | 'newline';

const KEY = 'markbrain:enterSends';

export function parseEnterSendMode(stored: string | null | undefined): EnterSendMode {
  return stored === 'newline' ? 'newline' : 'send';
}

/** What the composer should do with a keypress. */
export type ComposerKeyAction =
  /** Swallow the key and submit. */
  | 'send'
  /** Leave the key alone so the textarea inserts a newline / the browser handles it. */
  | 'newline'
  /** Not the send key at all — leave it entirely alone. */
  | 'ignore';

/**
 * The whole keyboard contract in one pure function, so the two composers
 * (hero and in-thread) can never drift apart and a test can pin every corner.
 *
 * `isComposing` matters: mid-IME (Chinese/Japanese/Korean, or any autocomplete
 * popup) Enter commits the candidate, and treating that as "send" would fire a
 * half-typed message. A composition keystroke is never a send.
 */
export function composerKeyAction(
  event: {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    isComposing?: boolean;
  },
  mode: EnterSendMode
): ComposerKeyAction {
  if (event.key !== 'Enter') return 'ignore';
  if (event.isComposing) return 'ignore';
  if (event.shiftKey) return 'newline'; // Shift+Enter never sends.
  if (event.ctrlKey || event.metaKey) return 'send'; // Ctrl/Cmd+Enter always sends.
  return mode === 'send' ? 'send' : 'newline';
}

/** The one-line hint under the hero composer, and the thread box's tooltip. */
export function enterSendHint(mode: EnterSendMode): string {
  return mode === 'send'
    ? 'Enter sends · Shift+Enter for a new line'
    : 'Enter for a new line · Ctrl+Enter sends';
}

export function loadEnterSendMode(): EnterSendMode {
  try {
    return parseEnterSendMode(window.localStorage.getItem(KEY));
  } catch {
    return 'send';
  }
}

export function saveEnterSendMode(mode: EnterSendMode): void {
  try {
    if (mode === 'send') window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, mode);
  } catch {
    // Private mode / storage disabled — the in-memory choice still applies
    // for this session, which is better than dropping the click.
  }
}
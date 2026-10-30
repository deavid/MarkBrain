/**
 * The composers: one shared draft + padlock state behind the hero (empty
 * thread) and footer (ongoing thread) forms, plus the shared unlock popup.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Lock, Plus, Send, Square } from 'lucide-react';
import { logger } from '../../utils/logger';
import type { ChatCapabilities } from '../../domains/06-chat-threads/types';
import { resolveCapabilities } from '../../domains/06-chat-threads/types';
import { CapabilitiesPopover } from './CapabilitiesPopover';
import { composerKeyAction, enterSendHint } from './sendOnEnter';
import type { EnterSendMode } from './sendOnEnter';
import { authUnlock } from '../../gateway/api';
import { unlockLocalVault, hasSavedLocalVault, isLocalVaultUnlocked } from '../../data/localKeyVault';
import {
  isVaultLocked,
  setVaultLocked,
  subscribeVaultLock,
  getReArmKey,
  rememberReArmKey,
  tryReArmVault,
} from '../../data/vaultReArm';
import { getWorkspaceMode } from '../../services/workspaceSession';
import { requestSyncNow } from '../../application/syncBus';
import { getModelForSlot } from '../../data/modelConfig';
import {
  evaluateSendReadiness,
  subscribeReadiness,
  getReadinessVersion,
} from '../../data/sendReadiness';

/** How many lines the composer grows to fit before it starts scrolling. */
const COMPOSER_MAX_LINES = 5;

/**
 * Grow the composer to fit its text, up to COMPOSER_MAX_LINES.
 *
 * A textarea with rows={1} shows ONE row and scrolls the rest away, so a
 * multi-line message was invisible while you typed it. This is deliberately
 * capped: the composer belongs to typing, not to reading, so it opens small
 * and never eats the thread.
 */
const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (!el) return;
  el.style.height = 'auto';
  const cs = window.getComputedStyle(el);
  const lineHeight = parseFloat(cs.lineHeight) || 22;
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const max = lineHeight * COMPOSER_MAX_LINES + padY;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
};

export interface ComposerOptions {
  /** Lifted chat draft (LAW 4). Absent → local state. */
  draftText?: string;
  onDraftTextChange?: (text: string) => void;
  isLoading: boolean;
  onSendMessage: (text: string) => Promise<void>;
  /** design 25 §1.1: a send with no configured key routes here. */
  onOpenKeySettings?: () => void;
  /** What a bare Enter does: send, or insert a new line. */
  enterSend: EnterSendMode;
}

export interface ComposerState {
  inputText: string;
  setInputText: (value: string) => void;
  handleComposerKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent) => void;
  sendBlocked: boolean;
  readiness: ReturnType<typeof evaluateSendReadiness>;
  vaultLocked: boolean;
  handlePadlockClick: () => Promise<void>;
  composerUnlockOpen: boolean;
  setComposerUnlockOpen: (open: boolean) => void;
  composerPw: string;
  setComposerPw: (pw: string) => void;
  composerUnlockErr: string;
  setComposerUnlockErr: (err: string) => void;
  composerUnlockBusy: boolean;
  handleComposerUnlock: () => Promise<void>;
}

export function useComposer(options: ComposerOptions): ComposerState {
  const { draftText, onDraftTextChange, isLoading, onSendMessage, onOpenKeySettings, enterSend } = options;

  // Controlled when App lifts the draft; local fallback for uncontrolled mounts.
  const [localDraft, setLocalDraft] = useState('');
  const draftIsControlled = draftText !== undefined;
  const inputText = draftIsControlled ? draftText : localDraft;
  const setInputText = (value: string) => {
    if (draftIsControlled) onDraftTextChange?.(value);
    else setLocalDraft(value);
  };
  const [showPrompts, setShowPrompts] = useState(false);
  /* ── design 25: proactive vault padlock ─────────────────────────────────── */
  // The send button IS the lock indicator: locked keys show a padlock, and a
  // locked send opens the unlock row instead of failing after the fact.
  const vaultLocked = useSyncExternalStore(subscribeVaultLock, isVaultLocked);
  // design 25 §1.1: "no key configured" is a SECOND blocked state — a send
  // that cannot work is never attempted; the user is routed to Model
  // Settings → Keys instead.
  useSyncExternalStore(subscribeReadiness, getReadinessVersion);
  const chatModelId = getModelForSlot('chat') ?? '';
  const readiness = evaluateSendReadiness(chatModelId);
  const sendBlocked = !readiness.ok;
  const [composerUnlockOpen, setComposerUnlockOpen] = useState(false);
  const [composerPw, setComposerPw] = useState('');
  const [composerUnlockErr, setComposerUnlockErr] = useState('');
  const [composerUnlockBusy, setComposerUnlockBusy] = useState(false);
  // Local mode: derive the initial state from the browser vault (the bus has
  // no history across mounts; the VPS bus is fed by login + the delta poll).
  useEffect(() => {
    if (getWorkspaceMode() !== 'local') return;
    setVaultLocked(hasSavedLocalVault() ? !isLocalVaultUnlocked() : false);
  }, []);
  const handlePadlockClick = async () => {
    // No configured key: no send to unlock — route to Model Settings → Keys.
    if (readiness.reason === 'no-key') {
      onOpenKeySettings?.();
      return;
    }
    // A tab holding a derived key re-arms silently — no password needed.
    if (getWorkspaceMode() === 'vps' && getReArmKey()) {
      if (await tryReArmVault()) return;
    }
    setComposerUnlockErr('');
    setComposerUnlockOpen(true);
  };
  const handleComposerUnlock = async () => {
    const pw = composerPw;
    if (!pw) {
      setComposerUnlockErr('Enter your password.');
      return;
    }
    setComposerUnlockBusy(true);
    setComposerUnlockErr('');
    try {
      if (getWorkspaceMode() === 'vps') {
        const res = await authUnlock(pw);
        if (!res.ok) {
          setComposerUnlockErr('Wrong password — try again.');
          return;
        }
        const body = (await res.json().catch(() => null)) as { rearmKey?: string } | null;
        rememberReArmKey(body?.rearmKey);
        setVaultLocked(false);
      } else {
        const ok = await unlockLocalVault(pw);
        if (!ok) {
          setComposerUnlockErr('Wrong passphrase — try again.');
          return;
        }
        setVaultLocked(false);
      }
      setComposerPw('');
      setComposerUnlockOpen(false);
      // Confirm the fresh server state (keys configured, tier, lock) NOW —
      // not on the next 10s poll.
      requestSyncNow();
    } catch {
      setComposerUnlockErr('Unlock failed — try again.');
    } finally {
      setComposerUnlockBusy(false);
    }
  };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // design 25: a send that cannot work is never attempted — locked keys
    // open the unlock popup; missing keys open Model Settings → Keys.
    if (sendBlocked) {
      void handlePadlockClick();
      return;
    }
    if (!inputText.trim()) {
      logger.warn('ChatView', 'Ignored empty submission attempt');
      return;
    }
    if (isLoading) {
      logger.warn('ChatView', 'Ignored submission while reasoning stream is active');
      return;
    }
    const msg = inputText;
    logger.action('ChatView', 'User sent message', { length: msg.length, snippet: msg.substring(0, 80) });
    setInputText('');
    setShowPrompts(false);
    onSendMessage(msg);
  };
  /**
   * One keyboard contract for both composers. Shift+Enter and Ctrl/Cmd+Enter
   * are fixed; only the bare Enter key answers to the `enterSend` preference.
   * A 'newline' verdict deliberately does NOT preventDefault — the textarea
   * inserts the break itself, which is the whole point.
   */
  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const action = composerKeyAction(
      { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, isComposing: e.nativeEvent.isComposing },
      enterSend
    );
    if (action !== 'send') return;
    e.preventDefault();
    if (inputText.trim() && !isLoading) {
      handleSubmit(e);
    }
  };


  return {
    inputText,
    setInputText,
    handleComposerKeyDown,
    handleSubmit,
    sendBlocked,
    readiness,
    vaultLocked,
    handlePadlockClick,
    composerUnlockOpen,
    setComposerUnlockOpen,
    composerPw,
    setComposerPw,
    composerUnlockErr,
    setComposerUnlockErr,
    composerUnlockBusy,
    handleComposerUnlock,
  };
}

/** Everything both composer forms share, built by {@link useComposer}. */
export interface ComposerProps {
  composer: ComposerState;
  /** What a bare Enter does: send, or insert a new line. Shift/Ctrl are fixed. */
  enterSend: EnterSendMode;
  resolvedCapabilities: ReturnType<typeof resolveCapabilities>;
  onSetProjectCapabilities?: (caps: Partial<ChatCapabilities>) => void;
  /** Unattached artifacts scoring above threshold against the current draft. */
  missingMatchCount: number;
  onOpenArtifacts?: () => void;
  onOpenArtifactsWithProximity?: () => void;
  isLoading: boolean;
  onStopGeneration?: () => void;
}

/** The shared unlock POPUP — opened by the padlock (design 25 §1). */
export const ComposerUnlockModal: React.FC<{ composer: ComposerState }> = ({ composer }) => {
  const {
    vaultLocked,
    composerUnlockOpen,
    setComposerUnlockOpen,
    composerPw,
    setComposerPw,
    composerUnlockErr,
    setComposerUnlockErr,
    composerUnlockBusy,
    handleComposerUnlock,
  } = composer;
  /** The shared unlock POPUP — opened by the padlock (design 25 §1). */
  const composerUnlockRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (composerUnlockOpen) {
      setComposerPw('');
      setComposerUnlockErr('');
      // Focus lands AFTER the overlay paints — a rAF keeps it reliable.
      const id = requestAnimationFrame(() => composerUnlockRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [composerUnlockOpen]);

  const composerUnlockModal = vaultLocked && composerUnlockOpen ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      data-testid="composer-vault-unlock-row"
      onClick={() => setComposerUnlockOpen(false)}
    >
      <div
        className="rounded-2xl bg-surface-1 shadow-pop p-4 w-[320px] space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-ink">Keys are locked</span>
        </div>
        <p className="text-11 text-ink-faint">
          Enter your password to unlock. Sends are held until then.
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={composerUnlockRef}
            type="password"
            data-testid="composer-vault-unlock-password"
            value={composerPw}
            onChange={(e) => setComposerPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleComposerUnlock();
              }
              if (e.key === 'Escape') setComposerUnlockOpen(false);
            }}
            placeholder="Password"
            aria-label="Password to unlock your keys"
            className="flex-1 rounded-lg bg-recess-1 shadow-well px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="button"
            data-testid="composer-vault-unlock"
            onClick={() => void handleComposerUnlock()}
            disabled={composerUnlockBusy}
            className="rounded-lg bg-amber-500 hover:bg-amber-400 px-3 py-1.5 text-xs font-semibold text-[#231a02] disabled:opacity-50 cursor-pointer"
          >
            Unlock
          </button>
        </div>
        {composerUnlockErr && <span className="text-11 text-red-400">{composerUnlockErr}</span>}
      </div>
    </div>
  ) : null;

  return composerUnlockModal;
};


/** The composer of an empty thread: the hero form. */
export const HeroComposer: React.FC<ComposerProps> = ({
  composer,
  enterSend,
  resolvedCapabilities,
  onSetProjectCapabilities,
  missingMatchCount,
  onOpenArtifacts,
  onOpenArtifactsWithProximity,
  isLoading,
  onStopGeneration,
}) => {
  const { inputText, setInputText, handleComposerKeyDown, handleSubmit, sendBlocked, readiness } = composer;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  // Re-measure on every text change: paste, and the clear-after-send both land
  // without an onChange we control.
  useEffect(() => {
    autoGrow(inputRef.current);
  }, [inputText]);

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-veil-1 focus-within:bg-veil-2 rounded-2xl p-4 shadow-pop transition-colors space-y-3"
    >
      <textarea
        ref={(el) => { inputRef.current = el; autoGrow(el); }}
        value={inputText}
        onChange={(e) => { setInputText(e.target.value); autoGrow(e.target); }}
        onKeyDown={handleComposerKeyDown}
        placeholder="Pour it out before it evaporates — we'll organize later."
        rows={3}
        disabled={isLoading}
        autoFocus
        className="w-full bg-transparent text-xs sm:text-sm text-ink placeholder-[#50637f] focus:outline-none resize-none leading-relaxed font-sans"
      />

      <div className="flex items-center justify-between pt-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <CapabilitiesPopover
            resolved={resolvedCapabilities}
            onSetProject={(caps) => onSetProjectCapabilities?.(caps)}
          />
          <button
            type="button"
            onClick={() => {
              logger.action('ChatView', 'Open artifacts folder to attach (hero)', {
                matches: missingMatchCount,
              });
              if (missingMatchCount > 0 && onOpenArtifactsWithProximity) {
                onOpenArtifactsWithProximity();
              } else {
                onOpenArtifacts?.();
              }
            }}
            data-testid="open-artifacts"
            className="relative min-h-[30px] px-2.5 rounded-lg bg-surface-3 hover:bg-surface-4 text-ink-dim hover:text-ink transition-colors flex items-center gap-1.5 cursor-pointer font-mono text-11 shrink-0"
            title="Attach artifacts from the library"
            aria-label="Attach artifacts"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span>Attach</span>
            {missingMatchCount > 0 && (
              <span
                data-testid="attach-match-badge"
                className="min-w-[16px] h-[16px] px-1 rounded-full bg-[#67e8f9] text-[#06131f] text-9 font-mono font-bold flex items-center justify-center"
                title={`${missingMatchCount} unattached artifact${missingMatchCount === 1 ? '' : 's'} match this draft`}
              >
                {missingMatchCount}
              </span>
            )}
          </button>
          <span className="text-11 font-mono text-[#5b7394] hidden sm:inline">
            {enterSend === 'send' ? 'Enter sends' : 'Ctrl+Enter sends'}
          </span>
        </div>

        {/* Stop is ALWAYS reachable while a stream runs (design 23 §2.4):
            a spinner that eats the only button is a trap — found live. */}
        {isLoading && onStopGeneration ? (
          <button
            type="button"
            onClick={onStopGeneration}
            className="px-4 py-2 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-ink font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-red-900/30 cursor-pointer shrink-0"
            title="Stop generation"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>
        ) : (
          <button
            type="submit"
            // design 25: when the send is blocked (locked keys or no
            // key), the padlock IS the affordance — it must stay
            // clickable with an empty composer, or an empty chat
            // leaves you no way to unlock at all.
            disabled={isLoading || (!sendBlocked && !inputText.trim())}
            title={
              readiness.reason === 'no-key'
                ? 'Add an API key to send — Model Settings → Keys'
                : readiness.reason === 'vault-locked'
                  ? 'Keys locked — click to unlock'
                  : undefined
            }
            className={
              sendBlocked
                ? 'px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 active:bg-amber-400 text-[#231a02] font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-amber-900/30 cursor-pointer'
                : 'px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] disabled:opacity-40 text-ink font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer'
            }
          >
            <span>Start Dialogue</span>
            {sendBlocked ? <Lock className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </form>
  );
};

/** The composer of an ongoing thread: the footer form. */
export const ThreadComposer: React.FC<ComposerProps> = ({
  composer,
  enterSend,
  resolvedCapabilities,
  onSetProjectCapabilities,
  missingMatchCount,
  onOpenArtifacts,
  onOpenArtifactsWithProximity,
  isLoading,
  onStopGeneration,
}) => {
  const { inputText, setInputText, handleComposerKeyDown, handleSubmit, sendBlocked, readiness } = composer;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Re-measure on every text change: paste, and the clear-after-send both land
  // without an onChange we control.
  useEffect(() => {
    autoGrow(inputRef.current);
  }, [inputText]);

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-4xl mx-auto">
      <CapabilitiesPopover
        resolved={resolvedCapabilities}
        onSetProject={(caps) => onSetProjectCapabilities?.(caps)}
      />
      {/* [+] → the Artifacts folder IS the picker. The voice
          selector moved to the sidebar, where settings belong. */}
      <button
        type="button"
        onClick={() => {
          logger.action('ChatView', 'Open artifacts folder to attach', {
            matches: missingMatchCount,
          });
          if (missingMatchCount > 0 && onOpenArtifactsWithProximity) {
            onOpenArtifactsWithProximity();
          } else {
            onOpenArtifacts?.();
          }
        }}
        data-testid="open-artifacts"
        className="relative h-full px-2.5 py-2.5 rounded-lg bg-recess-1 shadow-well hover:bg-recess-2 text-ink-dim hover:text-ink transition-colors flex items-center gap-1.5 cursor-pointer font-mono text-10 sm:text-xs shrink-0"
        title="Attach artifacts from the library"
        aria-label="Attach artifacts"
      >
        <Plus className="w-3.5 h-3.5 shrink-0" />
        {missingMatchCount > 0 && (
          <span
            data-testid="attach-match-badge"
            className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-[#67e8f9] text-[#06131f] text-9 font-mono font-bold flex items-center justify-center"
            title={`${missingMatchCount} unattached artifact${missingMatchCount === 1 ? '' : 's'} match this draft`}
          >
            {missingMatchCount}
          </span>
        )}
      </button>
      <textarea
        ref={(el) => { inputRef.current = el; autoGrow(el); }}
        value={inputText}
        onChange={(e) => { setInputText(e.target.value); autoGrow(e.target); }}
        onKeyDown={handleComposerKeyDown}
        placeholder="Keep typing…"
        title={enterSendHint(enterSend)}
        disabled={isLoading}
        rows={1}
        className="flex-1 bg-recess-1 shadow-well rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:bg-recess-2 transition-colors resize-none leading-relaxed overflow-y-auto max-h-[140px]"
      />

      {isLoading && onStopGeneration ? (
        <button
          type="button"
          onClick={onStopGeneration}
          className="px-4 py-2.5 rounded-xl bg-[#dc2626] hover:bg-[#b91c1c] text-ink transition-all shadow-md shadow-red-900/30 flex items-center gap-1.5 cursor-pointer font-mono text-xs font-semibold shrink-0"
          title="Stop generation"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>Stop</span>
        </button>
      ) : (
        <button
          type="submit"
          // Same law as the other composer: the blocked padlock (locked
          // keys or no key) stays clickable with an empty input — it
          // routes to the unlock popup or Model Settings → Keys.
          disabled={!sendBlocked && !inputText.trim()}
          className={
            sendBlocked
              ? 'px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 active:bg-amber-400 text-[#231a02] transition-all shadow-md shadow-amber-900/30 flex items-center justify-center cursor-pointer shrink-0'
              : 'px-4 py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 disabled:hover:bg-[#2563eb] text-ink transition-all shadow-md shadow-blue-900/25 flex items-center justify-center cursor-pointer shrink-0'
          }
          title={
            readiness.reason === 'no-key'
              ? 'Add an API key to send — Model Settings → Keys'
              : readiness.reason === 'vault-locked'
                ? 'Keys locked — click to unlock'
                : 'Send message'
          }
        >
          {sendBlocked ? <Lock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
        </button>
      )}
    </form>
  );
};

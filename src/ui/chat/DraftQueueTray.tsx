/**
 * The draft queue tray: unpaired asks live here, one card per draft with the
 * honest phase chip, its exits, and the vault unlock row.
 */
import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, ScrollText } from 'lucide-react';
import type { ChatViewProps } from './ChatView';
import type { DraftProgress } from '../../application/draftQueue';
import { GRANULARITY_LABEL } from '../../domains/granularity';
import { AttachmentDot, formatTokens } from '../context/AttachmentControls';
import { authUnlock } from '../../gateway/api';
import { unlockLocalVault } from '../../data/localKeyVault';
import { getWorkspaceMode } from '../../services/workspaceSession';

/** One entry of the chat draft queue, exactly as ChatView receives it. */
export type ChatDraft = NonNullable<ChatViewProps['drafts']>[number];

/** Ticking elapsed clock for a draft phase (design 23 §2.2) — cleans up. */
export function useElapsed(since: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  return since === undefined ? 0 : Math.max(0, Math.floor((now - (since ?? now)) / 1000));
}

const PHASE_LABEL: Record<string, string> = {
  queued: 'QUEUED',
  connecting: 'CONNECTING',
  'awaiting-first-token': 'AWAITING FIRST TOKEN',
  writing: 'WRITING',
};

/** The one phase chip: honest state + clock (+ chars once writing). */
export const DraftPhaseChip: React.FC<{
  progress?: DraftProgress;
  kind?: 'send' | 'regenerate';
  fallback: string;
}> = ({ progress, kind, fallback }) => {
  const secs = useElapsed(progress ? (progress.phase === 'writing' ? progress.firstTokenAt ?? progress.since : progress.since) : undefined);
  const prefix = kind === 'regenerate' ? 'REGENERATE · ' : '';
  if (!progress) return <>{prefix}{fallback}</>;
  const label = PHASE_LABEL[progress.phase] ?? String(progress.phase).toUpperCase();
  if (progress.phase === 'queued') return <>{prefix}{label}</>;
  if (progress.phase === 'writing') {
    const chars = progress.chars ?? 0;
    return (
      <>
        {prefix}
        {label} · {secs}s · {chars.toLocaleString()} chars
      </>
    );
  }
  if (progress.phase === 'awaiting-first-token') {
    // The thinking count ticks exactly like the writing count (David
    // 2026-10-30). Zero reasoning → today's chip, unchanged.
    const rChars = progress.reasoningChars ?? 0;
    if (rChars > 0) {
      return (
        <>
          {prefix}
          {label} · {secs}s · {rChars.toLocaleString()} chars thinking
        </>
      );
    }
    return (
      <>
        {prefix}
        {label} · {secs}s — the model is thinking; no text yet
      </>
    );
  }
  return (
    <>
      {prefix}
      {label} · {secs}s
    </>
  );
};

export interface DraftQueueTrayProps {
  drafts: ChatDraft[];
  offlineReplica: boolean;
  tokensFor: (artifactId: string) => number;
  titleFor: (artifactId: string) => string;
  onRetryDraft?: (id: string) => void;
  onStoreAsIsDraft?: (id: string) => void;
  onDiscardDraft?: (id: string) => void;
  /** Inspect the flight-recorder call this draft's attempt produced (plan 30). */
  onInspectCall?: (callId: string) => void;
}

export const DraftQueueTray: React.FC<DraftQueueTrayProps> = ({
  drafts,
  offlineReplica,
  tokensFor,
  titleFor,
  onRetryDraft,
  onStoreAsIsDraft,
  onDiscardDraft,
  onInspectCall,
}) => {
  // VAULT_LOCKED unlock row state (design 23 §2.3) — per draft card.
  const [unlockPw, setUnlockPw] = useState<Record<string, string>>({});
  const [unlockErr, setUnlockErr] = useState<Record<string, string>>({});
  const [unlockBusy, setUnlockBusy] = useState<Record<string, boolean>>({});
  const handleUnlockDraft = async (d: { id: string }) => {
    const pw = unlockPw[d.id] ?? '';
    if (!pw) {
      setUnlockErr((e) => ({ ...e, [d.id]: 'Enter your password.' }));
      return;
    }
    setUnlockBusy((b) => ({ ...b, [d.id]: true }));
    setUnlockErr((e) => ({ ...e, [d.id]: '' }));
    try {
      const ok =
        getWorkspaceMode() === 'vps' ? (await authUnlock(pw)).ok : await unlockLocalVault(pw);
      if (ok) {
        onRetryDraft?.(d.id);
        setUnlockPw((p) => ({ ...p, [d.id]: '' }));
      } else {
        setUnlockErr((e) => ({ ...e, [d.id]: 'Wrong password — try again.' }));
      }
    } catch {
      setUnlockErr((e) => ({ ...e, [d.id]: 'Unlock failed — try again.' }));
    } finally {
      setUnlockBusy((b) => ({ ...b, [d.id]: false }));
    }
  };

  return (
    <>
  {/* Draft queue (design-docs/18): unpaired asks live here — never in the
      feed. A sending draft shows its streaming partial (the reply has not
      earned a place in the conversation yet); a failed/stopped one offers
      the three exits: Retry / Store as-is / Discard. */}
  {drafts.length > 0 && (
    <div className="mx-3 sm:mx-6 mb-2 space-y-1.5 shrink-0" data-testid="draft-queue">
      {drafts.map((d) => {
        const isBusy = d.state === 'sending';
        const isBlocked = d.state === 'failed' || d.state === 'stopped';
        return (
          <div
            key={d.id}
            data-testid={`draft-${d.state}`}
            className={`rounded-lg border px-3 py-2 text-11 font-mono ${
              isBlocked ? 'border-brand bg-red-500/[0.07]' : 'border-line bg-surface-2'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {isBlocked && <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                <span
                  data-testid="draft-phase-chip"
                  className={`shrink-0 font-semibold uppercase tracking-wider text-10 ${
                    isBlocked
                      ? 'text-red-300'
                      : isBusy
                        ? 'text-[#38bdf8]'
                        : 'text-ink-mute'
                  }`}
                >
                  {isBlocked ? (
                    d.state === 'stopped'
                      ? d.kind === 'regenerate'
                        ? 'Regenerate stopped'
                        : 'Stopped'
                      : d.kind === 'regenerate'
                        ? 'Regenerate failed'
                        : 'Failed'
                  ) : (
                    <DraftPhaseChip
                      progress={d.progress}
                      kind={d.kind}
                      fallback={
                        isBusy
                          ? d.kind === 'regenerate'
                            ? 'Regenerating the reply'
                            : 'Writing reply'
                          : drafts.some(
                                (x) =>
                                  x.id !== d.id &&
                                  x.threadId === d.threadId &&
                                  (x.state === 'failed' || x.state === 'stopped') &&
                                  x.createdAt <= d.createdAt
                              )
                            ? 'Queued — blocked by the failed draft above (choose Retry / Store as-is / Discard there)'
                            : d.kind === 'regenerate'
                              ? 'Regenerate queued'
                              : 'Queued'
                      }
                    />
                  )}
                </span>
                {isBlocked && d.reason && (
                  <span className="truncate text-red-200/90">{d.reason}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {isBlocked && !offlineReplica && (
                  <>
                    <button
                      type="button"
                      onClick={() => onRetryDraft?.(d.id)}
                      data-testid="draft-retry"
                      className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-ink font-semibold transition-colors cursor-pointer"
                    >
                      Retry
                    </button>
                    {d.partial && (
                      <button
                        type="button"
                        onClick={() => onStoreAsIsDraft?.(d.id)}
                        data-testid="draft-store-as-is"
                        className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-[#38bdf8] transition-colors cursor-pointer"
                      >
                        Store as-is
                      </button>
                    )}
                  </>
                )}
                {!offlineReplica && onInspectCall && d.callId && (
                  <button
                    type="button"
                    onClick={() => onInspectCall(d.callId!)}
                    data-testid="draft-inspect-call"
                    className="p-1.5 rounded-lg hover:bg-surface-3 text-[#50637f] hover:text-[#38bdf8] transition-colors cursor-pointer"
                    title="Exactly what was sent and what was received (raw provider payloads)"
                  >
                    <ScrollText className="w-3.5 h-3.5" />
                  </button>
                )}
                {(isBlocked || d.state === 'queued') && (
                  <button
                    type="button"
                    onClick={() => onDiscardDraft?.(d.id)}
                    data-testid="draft-discard"
                    className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-[#e0b96c] transition-colors cursor-pointer"
                  >
                    Discard
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1 truncate text-ink-dim">{d.text}</div>
            {/* Design 23 §2.1.3: the frozen payload, read-only — what this
                send actually carries. */}
            {d.attachments && d.attachments.length > 0 && (
              <div className="mt-1 flex items-center gap-1.5 flex-wrap text-10 font-mono text-ink-dim">
                <span data-testid="draft-payload">
                  {d.attachments.length} note{d.attachments.length === 1 ? '' : 's'} ·{' '}
                  {formatTokens(
                    d.attachments.reduce((sum, a) => sum + (tokensFor(a.artifactId) || 0), 0)
                  )}{' '}
                  tok riding this send
                </span>
                {d.attachments.map((a) => (
                  <span
                    key={a.artifactId}
                    className="flex items-center gap-1 rounded bg-recess-1 px-1.5 py-0.5 text-9 text-ink-faint"
                    title={titleFor(a.artifactId)}
                  >
                    <AttachmentDot
                      state={a.turnIndex === null ? 'staged' : a.granularity}
                      label={titleFor(a.artifactId)}
                      size="sm"
                    />
                    <span className="max-w-[120px] truncate">{titleFor(a.artifactId)}</span>
                    {GRANULARITY_LABEL[a.granularity]}
                  </span>
                ))}
              </div>
            )}
            {isBlocked && d.errorCode === 'VAULT_LOCKED' && (
              <div
                className="mt-1.5 flex items-center gap-1.5 flex-wrap"
                data-testid="draft-vault-unlock-row"
              >
                <input
                  type="password"
                  data-testid="draft-vault-unlock-password"
                  value={unlockPw[d.id] ?? ''}
                  onChange={(e) => setUnlockPw((p) => ({ ...p, [d.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleUnlockDraft(d);
                  }}
                  placeholder="Password"
                  aria-label="Password to unlock your keys"
                  className="w-40 rounded-lg bg-recess-1 shadow-well px-2 py-1 text-11 text-ink placeholder:text-ink-faint focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleUnlockDraft(d)}
                  data-testid="draft-vault-unlock"
                  disabled={unlockBusy[d.id]}
                  className="px-2 py-1 rounded-lg bg-surface-3 hover:bg-surface-4 text-ink font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {unlockBusy[d.id] ? 'Unlocking…' : 'Unlock & resend'}
                </button>
                {unlockErr[d.id] ? (
                  <span className="text-red-300">{unlockErr[d.id]}</span>
                ) : null}
              </div>
            )}
            {d.partial && (isBusy || isBlocked) && (
              <div className="mt-1.5 max-h-24 overflow-y-auto rounded bg-recess-1 px-2 py-1.5 text-11 text-ink-dim whitespace-pre-wrap">
                {d.partial}
              </div>
            )}
            {/* The model's thinking, live (David 2026-10-30): same
                partial-preview styling, thinking phase only — the reset to
                writing clears it, so the card never shows two streams. */}
            {isBusy &&
              d.progress?.phase === 'awaiting-first-token' &&
              (d.progress.reasoningChars ?? 0) > 0 &&
              d.progress.reasoningPreview && (
                <div
                  className="mt-1.5 max-h-24 overflow-y-auto rounded bg-recess-1 px-2 py-1.5 text-11 text-ink-dim whitespace-pre-wrap"
                  data-testid="draft-reasoning-preview"
                >
                  {d.progress.reasoningPreview}
                </div>
              )}
          </div>
        );
      })}
    </div>
  )}
    </>
  );
};

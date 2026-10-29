import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { ChatCapabilities } from '../../domains/06-chat-threads/types';

/**
 * The chat-capability toggles (Package 2 §2.5). One small button on the
 * composer row opens a compact panel: three plain checkboxes and a scope
 * picker ("this chat" writes the thread override, "all chats" writes the
 * project default). No jargon, no invented words — each line says what the
 * chat will actually do when it is on.
 */

type CapKey = keyof ChatCapabilities;

const ITEMS: Array<{ key: CapKey; label: string; hint: string }> = [
  {
    key: 'writeArtifacts',
    label: 'Write artifacts',
    hint: 'The chat can save new artifacts and update ones you already have.',
  },
  {
    key: 'autoChapter',
    label: 'Cut chapters',
    hint: 'The chat can start a new chapter when the talk moves to a new subject.',
  },
  {
    key: 'graphLinks',
    label: 'Link artifacts',
    hint: 'The chat can connect artifacts that belong together.',
  },
];

interface CapabilitiesPopoverProps {
  /** The resolved capability state (defaults ← project) — what the checkboxes show. */
  resolved: ChatCapabilities;
  onSetProject: (caps: Partial<ChatCapabilities>) => void;
}

export const CapabilitiesPopover: React.FC<CapabilitiesPopoverProps> = ({
  resolved,
  onSetProject,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const setCapability = (key: CapKey, value: boolean) => {
    // One scope, decided 2026-10-29: capabilities are a project setting.
    // No per-chat overrides — nobody wants to test two modes.
    onSetProject({ ...resolved, [key]: value });
  };

  return (
    <div ref={wrapRef} className="relative shrink-0" data-testid="capabilities-control">
      <button
        type="button"
        data-testid="capabilities-button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Chat behavior"
        title="Chat behavior"
        className="min-h-[30px] px-2 rounded-lg bg-surface-3 hover:bg-surface-4 text-ink-dim hover:text-ink transition-colors flex items-center cursor-pointer font-mono text-11 shrink-0"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          data-testid="capabilities-popover"
          className="absolute z-50 bottom-full mb-2 left-0 w-72 rounded-xl bg-surface-2 shadow-pop border border-line p-3 space-y-2.5"
        >
          <div className="text-11 font-mono font-semibold text-ink">Chat behavior</div>
          <div className="text-10 text-ink-mute leading-snug">
            For every chat in this project.
          </div>

          {ITEMS.map((item) => (
            <label
              key={item.key}
              className="flex items-start gap-2.5 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                data-testid={`capability-${item.key}`}
                checked={resolved[item.key]}
                onChange={(e) => setCapability(item.key, e.target.checked)}
                className="mt-0.5 w-3.5 h-3.5 accent-[#e05a66] cursor-pointer shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-xs text-ink font-medium">{item.label}</span>
                <span className="block text-10 text-ink-mute leading-snug">{item.hint}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

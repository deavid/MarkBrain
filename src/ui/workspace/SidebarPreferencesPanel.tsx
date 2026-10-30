/**
 * The reading/typing preference panel: chat text view, text size, send-on-Enter
 * and the read-aloud voice picker.
 */
import React from 'react';
import {
  ALargeSmall,
  CornerDownLeft,
  Type,
  Volume2,
} from 'lucide-react';
import { logger } from '../../utils/logger';
import { isOfflineReplica } from '../../services/workspaceSession';
import { ReadAloudControls } from './ReadAloudControls';
import type { ChatRenderMode } from '../chat/chatRenderMode';
import type { UiFontScale } from '../uiFontScale';
import type { EnterSendMode } from '../chat/sendOnEnter';

/** Read-aloud voices supported by the Gemini TTS endpoint (/api/tts). */
export const TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'] as const;

/** The global bubble-view switch, with the sentence that explains it on hover. */
const CHAT_RENDER_CHOICES: { mode: ChatRenderMode; label: string; hint: string }[] = [
  {
    mode: 'markdown',
    label: 'Markdown',
    hint: 'Render replies as formatted markdown (each message can still flip to Raw)',
  },
  {
    mode: 'raw',
    label: 'Raw',
    hint: 'Show the untouched markdown source of every message',
  },
];

/**
 * How big the interface text is. Phones cannot pinch-zoom (the viewport pins
 * user-scalable), so this is the only way to read at arm's length. The default
 * keeps the browser's own font-size preference; the steps scale everything.
 */
const UI_FONT_SCALE_CHOICES: { scale: UiFontScale; label: string; hint: string }[] = [
  { scale: 1, label: 'Default', hint: 'Design size — the browser font preference applies' },
  { scale: 1.15, label: 'Large', hint: '115% — a gentle step up everywhere' },
  { scale: 1.3, label: 'Larger', hint: '130% — comfortable on a phone' },
  { scale: 1.5, label: 'Largest', hint: '150% — arm\u2019s length reading' },
];

/**
 * What a bare Enter does in the composer. Only Enter is configurable here —
 * Shift+Enter always makes a new line and Ctrl/Cmd+Enter always sends, on every
 * keyboard and every viewport (including phones, where this panel is reachable
 * through the drawer).
 */
const ENTER_SEND_CHOICES: { mode: EnterSendMode; label: string; hint: string }[] = [
  {
    mode: 'send',
    label: 'Sends',
    hint: 'Enter sends the message · Shift+Enter makes a new line · Ctrl+Enter always sends',
  },
  {
    mode: 'newline',
    label: 'New line',
    hint: 'Enter makes a new line · Ctrl+Enter sends',
  },
];

export interface SidebarPreferencesPanelProps {
  /** Default bubble view in the chat: rendered markdown, or the raw source. */
  chatRender: ChatRenderMode;
  onSelectChatRender?: (mode: ChatRenderMode) => void;
  /** Interface text scale (see uiFontScale.ts). */
  fontScale: UiFontScale;
  onSelectFontScale?: (scale: UiFontScale) => void;
  enterSend: EnterSendMode;
  onSelectEnterSend?: (mode: EnterSendMode) => void;
  /** Read-aloud voice for TTS playback. */
  chosenVoice: string;
  onSelectVoice?: (voice: string) => void;
}

export const SidebarPreferencesPanel: React.FC<SidebarPreferencesPanelProps> = ({
  chatRender,
  onSelectChatRender,
  fontScale,
  onSelectFontScale,
  enterSend,
  onSelectEnterSend,
  chosenVoice,
  onSelectVoice,
}) => {
  return (
    <>
  {/* Reading preference, not project data: it sits next to the model
      picker because it is how you read what that model says. Every
      bubble still carries its own Raw toggle — this is just the
      default they start from. */}
  <div className="rounded-xl bg-surface-2 p-1.5">
    <div className="flex items-center gap-2.5 p-2.5 pb-1.5">
      <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
        <Type className="w-4 h-4 text-[#38bdf8]" />
      </div>
      <div className="min-w-0">
        <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
          Chat text
        </span>
        <span className="text-xs font-semibold text-ink truncate block">
          {chatRender === 'raw' ? 'Raw markdown' : 'Rendered markdown'}
        </span>
      </div>
    </div>
    <div className="px-1.5 pb-1.5 flex items-center gap-1">
      {CHAT_RENDER_CHOICES.map((choice) => {
        const isSelected = choice.mode === chatRender;
        return (
          <button
            key={choice.mode}
            type="button"
            aria-pressed={isSelected}
            aria-label={`Chat text: ${choice.label}`}
            onClick={() => {
              logger.action('Sidebar', `Chat text mode: ${choice.mode}`);
              onSelectChatRender?.(choice.mode);
            }}
            title={choice.hint}
            className={`flex-1 min-h-[26px] px-2.5 rounded-full text-10 font-mono transition-colors cursor-pointer ${
              isSelected
                ? 'bg-veil-3 shadow-lift text-ink font-semibold'
                : 'text-ink-faint hover:bg-veil-1 hover:text-ink-dim'
            }`}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  </div>

  {/* Text size. A reading preference like the two above; on a phone
      it is the only zoom there is, since the viewport pins
      user-scalable. The steps move every rem-sized text class through
      the root font size, plus the few px rules via --ui-scale. */}
  <div className="rounded-xl bg-surface-2 p-1.5">
    <div className="flex items-center gap-2.5 p-2.5 pb-1.5">
      <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
        <ALargeSmall className="w-4 h-4 text-[#9be07c]" />
      </div>
      <div className="min-w-0">
        <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
          Text size
        </span>
        <span className="text-xs font-semibold text-ink truncate block">
          {UI_FONT_SCALE_CHOICES.find((c) => c.scale === fontScale)?.label ?? 'Default'}
        </span>
      </div>
    </div>
    <div className="px-1.5 pb-1.5 flex items-center gap-1">
      {UI_FONT_SCALE_CHOICES.map((choice) => {
        const isSelected = choice.scale === fontScale;
        return (
          <button
            key={choice.scale}
            type="button"
            aria-pressed={isSelected}
            aria-label={`Text size: ${choice.label}`}
            data-testid={`font-scale-${choice.scale}`}
            onClick={() => {
              logger.action('Sidebar', `Text size: ${choice.scale}`);
              onSelectFontScale?.(choice.scale);
            }}
            title={choice.hint}
            className={`flex-1 min-h-[26px] px-2 rounded-full text-10 font-mono transition-colors cursor-pointer ${
              isSelected
                ? 'bg-veil-3 shadow-lift text-ink font-semibold'
                : 'text-ink-faint hover:bg-veil-1 hover:text-ink-dim'
            }`}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  </div>

  {/* Send-on-Enter preference. Another typing preference, so it sits
      with the others and is reachable on a phone through the drawer —
      which is the point of putting it here rather than in the composer.
      Shift+Enter and Ctrl/Cmd+Enter are NOT offered as choices: they are
      not preferences, they are the floor. */}
  <div className="rounded-xl bg-surface-2 p-1.5">
    <div className="flex items-center gap-2.5 p-2.5 pb-1.5">
      <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
        <CornerDownLeft className="w-4 h-4 text-[#e0b96c]" />
      </div>
      <div className="min-w-0">
        <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
          Send on Enter
        </span>
        <span className="text-xs font-semibold text-ink truncate block">
          {enterSend === 'send' ? 'Enter sends' : 'Enter makes a new line'}
        </span>
      </div>
    </div>
    <div className="px-1.5 pb-1.5 flex items-center gap-1">
      {ENTER_SEND_CHOICES.map((choice) => {
        const isSelected = choice.mode === enterSend;
        return (
          <button
            key={choice.mode}
            type="button"
            aria-pressed={isSelected}
            aria-label={`Send on Enter: ${choice.label}`}
            data-testid={`enter-send-${choice.mode}`}
            onClick={() => {
              logger.action('Sidebar', `Send on Enter: ${choice.mode}`);
              onSelectEnterSend?.(choice.mode);
            }}
            title={choice.hint}
            className={`flex-1 min-h-[26px] px-2.5 rounded-full text-10 font-mono transition-colors cursor-pointer ${
              isSelected
                ? 'bg-veil-3 shadow-lift text-ink font-semibold'
                : 'text-ink-faint hover:bg-veil-1 hover:text-ink-dim'
            }`}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  </div>

  {/* Block 3.5: Read-aloud voice (moved out of the chat composer —
      on a 350px phone the composer belongs to typing, not settings).
      Read-only replica: TTS is a server job — nothing to read aloud. */}
  {!isOfflineReplica() && (
  <div className="rounded-xl bg-surface-2 p-1.5">
    <div className="flex items-center justify-between p-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-recess-1 shadow-well flex items-center justify-center shrink-0">
          <Volume2 className="w-4 h-4 text-[#5ad49b]" />
        </div>
        <div className="min-w-0">
          <span className="text-10 font-mono uppercase tracking-wider text-ink-mute block">
            Read-aloud voice
          </span>
          <span className="text-xs font-semibold text-ink truncate block">{chosenVoice}</span>
        </div>
      </div>
    </div>
    <ReadAloudControls />
    <div className="px-1.5 pb-1.5 flex items-center gap-1 flex-wrap">
      {TTS_VOICES.map((v) => {
        const isSelected = v === chosenVoice;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={isSelected}
            aria-label={`Read-aloud voice ${v}`}
            onClick={() => {
              logger.action('Sidebar', `Selected TTS voice: ${v}`);
              onSelectVoice?.(v);
            }}
            className={`min-h-[26px] px-2.5 rounded-full text-10 font-mono transition-colors cursor-pointer ${
              isSelected
                ? 'bg-veil-3 shadow-lift text-ink font-semibold'
                : 'text-ink-faint hover:bg-veil-1 hover:text-ink-dim'
            }`}
          >
            {v}
          </button>
        );
      })}
    </div>
  </div>
  )}
    </>
  );
};

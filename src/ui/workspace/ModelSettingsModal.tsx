import React, { useEffect, useState } from 'react';
import { X, Settings2, KeyRound, Eye, EyeOff, Check } from 'lucide-react';
import { logger } from '../../utils/logger';
import { models as fetchModels } from '../../gateway/api';
import {
  DEFAULT_MODEL_SLOTS,
  MODEL_SLOTS,
  loadModelConfig,
  saveModelConfig,
} from '../../data/modelConfig';
import type { ModelSlot, ModelSlotConfig } from '../../data/modelConfig';
import {
  KEY_SLOTS,
  KEY_SLOT_INFO,
  getKeySlot,
  setKeySlot,
  listFilledKeySlots,
  loadLaneKeys,
  setLaneKey,
} from '../../data/keySlots';
import type { KeySlotId, LaneKeyChoice } from '../../data/keySlots';

/**
 * ModelSettingsModal — the capability-slot picker (design-docs/16 §3.1, D2/D7).
 *
 * Seven lanes, not one global model: chat gets the prominent top row (that is
 * where reasoning power vs money is spent), extract/summarize/qaGen/title are
 * workhorse lanes, embed/tts are infrastructure lanes with free-quota defaults.
 * Every slot writes straight to localStorage via saveModelConfig — the next
 * request on that lane picks it up (getModelForSlot reads per call on purpose).
 *
 * Keys (BYOK) sit on their own tab. Storage is plain localStorage — the real
 * wall is provider-side key restriction (domain allowlist), not client crypto.
 */

interface ModelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Catalog as currently known by App (sidebar list). A fresh fetch runs on open. */
  catalog: Array<{
    id: string;
    name: string;
    capabilities?: string[];
    available?: boolean;
    quotaNote?: string;
  }>;
}

interface SlotRow {
  slot: ModelSlot;
  label: string;
  group: 'chat' | 'workhorse' | 'infra';
}

type ModalCatalogEntry = ModelSettingsModalProps['catalog'][number];

const SLOT_ROWS: SlotRow[] = [
  { slot: 'chat', label: 'Chat', group: 'chat' },
  { slot: 'extract', label: 'Extract', group: 'workhorse' },
  { slot: 'summarize', label: 'Summarize', group: 'workhorse' },
  { slot: 'qaGen', label: 'Q&A gen', group: 'workhorse' },
  { slot: 'title', label: 'Titles', group: 'workhorse' },
  { slot: 'embed', label: 'Embeddings', group: 'infra' },
  { slot: 'tts', label: 'Read-aloud', group: 'infra' },
];

function optionsFor(slot: ModelSlot, catalog: ModalCatalogEntry[]): ModalCatalogEntry[] {
  return catalog.filter((m) => !m.capabilities || m.capabilities.includes(slot));
}

function keySlotPlaceholder(id: KeySlotId): string {
  return id === 'openrouter' ? 'sk-or-… (optional)' : 'AIza… (optional)';
}

export const ModelSettingsModal: React.FC<ModelSettingsModalProps> = ({ isOpen, onClose, catalog }) => {
  const [slots, setSlots] = useState<ModelSlotConfig>(DEFAULT_MODEL_SLOTS);
  const [liveCatalog, setLiveCatalog] = useState<ModalCatalogEntry[]>(catalog);
  const [keyValues, setKeyValues] = useState<Record<KeySlotId, string>>({
    'gemini-free': '',
    'gemini-paid': '',
    openrouter: '',
  });
  const [shownKeys, setShownKeys] = useState<Record<KeySlotId, boolean>>({
    'gemini-free': false,
    'gemini-paid': false,
    openrouter: false,
  });
  const [laneKeys, setLaneKeys] = useState<Record<string, LaneKeyChoice>>({});
  // NOT VERIFIED — see design-docs/16. Hidden unless VITE_BYOK=1, because the
  // bring-your-own-key model is unsettled and David will not ship something he
  // cannot validate.
  const byokEnabled = import.meta.env.VITE_BYOK === '1';
  const [tab, setTab] = useState<'models' | 'keys'>('models');

  useEffect(() => {
    if (!isOpen) return;
    setSlots(loadModelConfig());
    setLaneKeys(loadLaneKeys());
    const filled: Record<KeySlotId, string> = { 'gemini-free': '', 'gemini-paid': '', openrouter: '' };
    for (const id of KEY_SLOTS) filled[id] = getKeySlot(id) ?? '';
    setKeyValues(filled);
    let alive = true;
    // The server catalog (GET /api/models) is the only model list. We never
    // call provider model endpoints with the user's keys — catalog fetching
    // without an explicit user action was cut as unwanted network traffic.
    fetchModels()
      .then((data) => {
        if (alive && Array.isArray(data?.models) && data.models.length > 0) {
          setLiveCatalog(data.models);
        }
      })
      .catch(() => {
        /* keep the catalog App already had */
      });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const setSlot = (slot: ModelSlot, modelId: string) => {
    const next = { ...slots, [slot]: modelId };
    setSlots(next);
    saveModelConfig(next);
    logger.action('ModelSettings', `Slot ${slot} → ${modelId}`);
  };

  const commitKey = (id: KeySlotId, value: string) => {
    setKeyValues((prev) => ({ ...prev, [id]: value }));
    setKeySlot(id, value);
    logger.action('ModelSettings', `Key slot ${id} ${value.trim() ? 'stored' : 'cleared'}`);
  };

  const toggleShown = (id: KeySlotId) =>
    setShownKeys((prev) => ({ ...prev, [id]: !prev[id] }));

  const refreshKeyValues = () => {
    const filled: Record<KeySlotId, string> = { 'gemini-free': '', 'gemini-paid': '', openrouter: '' };
    for (const id of KEY_SLOTS) filled[id] = getKeySlot(id) ?? '';
    setKeyValues(filled);
  };

  /** D8: one-click Free↔Paid flip for a lane, only when both keys exist. */
  const swapChatKey = () => {
    const current = laneKeys.chat ?? 'auto';
    const next: LaneKeyChoice =
      current === 'gemini-paid' ? 'gemini-free' : 'gemini-paid';
    setLaneKeys((prev) => ({ ...prev, chat: next }));
    setLaneKey('chat', next);
    logger.action('ModelSettings', `Chat lane key → ${next}`);
  };

  const chatKeyChoice = laneKeys.chat ?? 'auto';
  const bothGeminiKeys = getKeySlot('gemini-free') !== null && getKeySlot('gemini-paid') !== null;

  const renderRow = (row: SlotRow) => {
    const options = optionsFor(row.slot, liveCatalog);
    const isChat = row.group === 'chat';
    if (!isChat) {
      return (
        <div
          key={row.slot}
          data-testid={`slot-${row.slot}`}
          className="flex items-center justify-between gap-2"
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-ink-mute shrink-0">
            {row.label}
          </span>
          <select
            data-testid={`select-${row.slot}`}
            value={slots[row.slot]}
            onChange={(e) => setSlot(row.slot, e.target.value)}
            className="shrink-0 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1 shadow-well cursor-pointer min-w-[10rem]"
          >
            {options.length === 0 && (
              <option value={slots[row.slot]}>{slots[row.slot]} (not in catalog)</option>
            )}
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.available === false ? ' — no key' : ''}
              </option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div
        key={row.slot}
        data-testid={`slot-${row.slot}`}
        className="rounded-xl p-3 bg-veil-1 shadow-lift"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`font-mono uppercase tracking-wider ${isChat ? 'text-xs font-semibold text-ink' : 'text-[10px] text-ink-mute'}`}
              >
                {row.label}
              </span>
              {isChat && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-veil-3 text-[#38bdf8]">
                  main
                </span>
              )}
            </div>
          </div>
          <select
            data-testid={`select-${row.slot}`}
            value={slots[row.slot]}
            onChange={(e) => setSlot(row.slot, e.target.value)}
            className="shrink-0 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 shadow-well cursor-pointer min-w-[13rem]"
          >
            {options.length === 0 && (
              <option value={slots[row.slot]}>{slots[row.slot]} (not in catalog)</option>
            )}
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.available === false ? ' — no key' : ''}
              </option>
            ))}
          </select>
        </div>
        {isChat && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#556985]">
              Signing key
            </span>
            <span className="text-[10px] font-mono text-ink" data-testid="chat-key-choice">
              {chatKeyChoice === 'auto'
                ? 'auto (first filled Gemini key)'
                : KEY_SLOT_INFO[chatKeyChoice as KeySlotId]?.label ?? chatKeyChoice}
            </span>
            {bothGeminiKeys && (
              <button
                onClick={swapChatKey}
                data-testid="swap-chat-key"
                className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[10px] font-mono text-[#38bdf8] shadow-well cursor-pointer"
              >
                {chatKeyChoice === 'gemini-paid' ? 'Use Free key' : 'Use Paid key'}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="model-settings-modal"
        className="relative w-full max-w-2xl max-h-[85vh] bg-surface-0 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-ink font-mono animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="px-5 py-3.5 bg-surface-1 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center text-[#38bdf8]">
              <Settings2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink tracking-wide">Model Settings</h2>
              <p className="text-[10px] text-[#6b82a3]">
                One model per lane — changes apply to the next request.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="model-settings-close"
            className="w-8 h-8 rounded-lg bg-surface-3 hover:bg-surface-4 flex items-center justify-center text-ink-mute hover:text-ink transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="flex gap-1 p-1 rounded-xl bg-surface-2" role="tablist" aria-label="Model settings sections">
            {(['models', 'keys'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                data-testid={`settings-tab-${t}`}
                onClick={() => setTab(t)}
                className={`flex-1 min-h-[28px] rounded-lg text-[11px] font-mono uppercase tracking-wider transition-colors cursor-pointer ${
                  tab === t
                    ? 'bg-surface-3 shadow-lift text-ink font-semibold'
                    : 'text-ink-faint hover:text-ink-dim'
                }`}
              >
                {t === 'models' ? 'Models' : 'Keys'}
              </button>
            ))}
          </div>

          {tab === 'models' && (
          <>
          <section>
            <div className="text-[9px] font-mono uppercase tracking-wider text-[#556985] px-1 mb-1.5">
              Chat
            </div>
            {SLOT_ROWS.filter((r) => r.group === 'chat').map(renderRow)}
          </section>

          <section>
            <div className="text-[9px] font-mono uppercase tracking-wider text-[#556985] px-1 mb-1.5">
              Workhorse
            </div>
            <div className="space-y-1">{SLOT_ROWS.filter((r) => r.group === 'workhorse').map(renderRow)}</div>
          </section>

          <section>
            <div className="text-[9px] font-mono uppercase tracking-wider text-[#556985] px-1 mb-1.5">
              Infrastructure
            </div>
            <div className="space-y-1">{SLOT_ROWS.filter((r) => r.group === 'infra').map(renderRow)}</div>
          </section>
          </>
          )}

          {tab === 'keys' && (
          <>
          {!byokEnabled && (
            <section className="rounded-xl bg-recess-1 p-3" data-testid="key-status">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-mute mb-1.5">
                <KeyRound className="w-3.5 h-3.5 text-[#e0b96c]" />
                Keys
              </div>
              <p className="text-xs text-ink-dim">
                Your messages are sent using the server owner’s API key. Using
                your own key is not available yet.
              </p>
            </section>
          )}
          {byokEnabled && (
          <section className="rounded-xl bg-recess-1 p-3" data-testid="key-status">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-mute">
              <KeyRound className="w-3.5 h-3.5 text-[#e0b96c]" />
              Keys
            </div>
            <p className="text-[11px] text-[#788fa8] leading-relaxed mt-1.5 mb-3">
              Stored in this browser only, and only sent to the provider each
              key belongs to. Empty slots are fine — those lanes use the
              server owner’s key.
            </p>
            <div className="space-y-2">
              {KEY_SLOTS.map((id) => (
                <div key={id} data-testid={`key-slot-${id}`} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[10px] font-mono text-ink-mute">
                    {KEY_SLOT_INFO[id].label}
                  </span>
                  <div className="flex-1 relative">
                    <input
                      type={shownKeys[id] ? 'text' : 'password'}
                      value={keyValues[id]}
                      onChange={(e) => commitKey(id, e.target.value)}
                      placeholder={keySlotPlaceholder(id)}
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 pr-8 shadow-well disabled:opacity-50"
                    />
                    <button
                      onClick={() => toggleShown(id)}
                      title={shownKeys[id] ? 'Hide key' : 'Show key'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-mute hover:text-ink cursor-pointer"
                    >
                      {shownKeys[id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {getKeySlot(id) !== null ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                </div>
              ))}
            </div>
            {listFilledKeySlots().length === 0 && (
              <p className="text-[10px] text-[#788fa8] font-mono mt-2">
                No keys configured — every lane uses the server owner’s key.
              </p>
            )}

          </section>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { X, Settings2, KeyRound, Info } from 'lucide-react';
import { logger } from '../../utils/logger';
import { models as fetchModels } from '../../gateway/api';
import {
  DEFAULT_MODEL_SLOTS,
  MODEL_SLOTS,
  loadModelConfig,
  saveModelConfig,
} from '../../data/modelConfig';
import type { ModelSlot, ModelSlotConfig } from '../../data/modelConfig';

/**
 * ModelSettingsModal — the capability-slot picker (design-docs/16 §3.1, D2/D7).
 *
 * Seven lanes, not one global model: chat gets the prominent top row (that is
 * where reasoning power vs money is spent), extract/summarize/qaGen/title are
 * workhorse lanes, embed/tts are infrastructure lanes with free-quota defaults.
 * Every slot writes straight to localStorage via saveModelConfig — the next
 * request on that lane picks it up (getModelForSlot reads per call on purpose).
 *
 * Keys (BYOK) are Phase 1: this Phase 0 popup shows the server-key status and
 * stops there. Do not add key inputs here until the vault/storage tier exists.
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
  hint: string;
  group: 'chat' | 'workhorse' | 'infra';
}

type ModalCatalogEntry = ModelSettingsModalProps['catalog'][number];

const SLOT_ROWS: SlotRow[] = [
  { slot: 'chat', label: 'Chat', hint: 'The replies you read. Reasoning power vs money lives here.', group: 'chat' },
  { slot: 'extract', label: 'Extract', hint: 'Import lane — files become structured notes.', group: 'workhorse' },
  { slot: 'summarize', label: 'Summarize', hint: 'Chapter recaps and descriptions.', group: 'workhorse' },
  { slot: 'qaGen', label: 'Q&A gen', hint: 'Search-index question/answer generation.', group: 'workhorse' },
  { slot: 'title', label: 'Titles', hint: 'Thread titles (2–6 words, best-effort).', group: 'workhorse' },
  { slot: 'embed', label: 'Embeddings', hint: 'Search-index vectors. Not comparable across models.', group: 'infra' },
  { slot: 'tts', label: 'Read-aloud', hint: 'Voice synthesis.', group: 'infra' },
];

function optionsFor(slot: ModelSlot, catalog: ModalCatalogEntry[]): ModalCatalogEntry[] {
  return catalog.filter((m) => !m.capabilities || m.capabilities.includes(slot));
}

export const ModelSettingsModal: React.FC<ModelSettingsModalProps> = ({ isOpen, onClose, catalog }) => {
  const [slots, setSlots] = useState<ModelSlotConfig>(DEFAULT_MODEL_SLOTS);
  const [liveCatalog, setLiveCatalog] = useState<ModalCatalogEntry[]>(catalog);

  useEffect(() => {
    if (!isOpen) return;
    setSlots(loadModelConfig());
    let alive = true;
    // Fresh catalog on open — the server is the source of truth for what exists.
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

  const renderRow = (row: SlotRow) => {
    const options = optionsFor(row.slot, liveCatalog);
    const isChat = row.group === 'chat';
    return (
      <div
        key={row.slot}
        data-testid={`slot-${row.slot}`}
        className={`rounded-xl p-3 ${isChat ? 'bg-veil-1 shadow-lift' : 'bg-surface-2'}`}
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
            <p className="text-[10px] text-[#788fa8] leading-tight mt-1">{row.hint}</p>
          </div>
          <select
            data-testid={`select-${row.slot}`}
            value={slots[row.slot]}
            onChange={(e) => setSlot(row.slot, e.target.value)}
            className={`shrink-0 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 shadow-well cursor-pointer ${
              isChat ? 'min-w-[13rem]' : 'min-w-[11rem]'
            }`}
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
        {options.find((m) => m.id === slots[row.slot])?.quotaNote && (
          <p className="text-[10px] text-[#e0b96c] font-mono mt-1.5">
            {options.find((m) => m.id === slots[row.slot])!.quotaNote}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div
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
            <div className="space-y-1.5">{SLOT_ROWS.filter((r) => r.group === 'workhorse').map(renderRow)}</div>
          </section>

          <section>
            <div className="text-[9px] font-mono uppercase tracking-wider text-[#556985] px-1 mb-1.5">
              Infrastructure
            </div>
            <div className="space-y-1.5">{SLOT_ROWS.filter((r) => r.group === 'infra').map(renderRow)}</div>
          </section>

          <section className="rounded-xl bg-recess-1 p-3" data-testid="key-status">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-mute">
              <KeyRound className="w-3.5 h-3.5 text-[#e0b96c]" />
              Keys
            </div>
            <p className="text-[11px] text-[#788fa8] leading-relaxed mt-1.5">
              This deployment uses the server's API key (Phase 0). Bring-your-own-key
              storage — including the optional Free/Paid Gemini slots — arrives in
              Phase 1 (design-docs/16). All keys will be optional.
            </p>
          </section>

          <div className="flex items-start gap-2 px-1">
            <Info className="w-3.5 h-3.5 text-[#556985] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[#556985] leading-relaxed">
              Free-tier quotas are real: <span className="text-[#e0b96c]">3.8 Flash</span> allows
              ~20 requests/day and its latency swings from 1.3s to minutes under load. If a big-brain
              reply is downgraded, the message says so — nothing swaps silently.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

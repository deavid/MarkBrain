/**
 * The Model Slots tab: one model per lane, written straight to the mode-scoped
 * localStorage slot — the next request on that lane picks it up.
 */
import React from 'react';
import { SLOT_ROWS, optionsFor } from './shared';
import type { SlotRow, ModalCatalogEntry } from './shared';
import { KEY_SLOT_INFO } from '../../../data/keySlots';
import type { KeySlotId } from '../../../data/keySlots';
import type { ModelSlot, ModelSlotConfig } from '../../../data/modelConfig';

export interface ModelSlotsTabProps {
  slots: ModelSlotConfig;
  liveCatalog: ModalCatalogEntry[];
  setSlot: (slot: ModelSlot, modelId: string) => void;
  mode: 'local' | 'vps';
  chatKeyChoice: string;
  bothGeminiKeys: boolean;
  swapChatKey: () => void;
}

export const ModelSlotsTab: React.FC<ModelSlotsTabProps> = ({
  slots,
  liveCatalog,
  setSlot,
  mode,
  chatKeyChoice,
  bothGeminiKeys,
  swapChatKey,
}) => {
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
          <span className="text-10 font-mono uppercase tracking-wider text-ink-mute shrink-0">
            {row.label}
          </span>
          <select
            data-testid={`select-${row.slot}`}
            value={slots[row.slot]}
            onChange={(e) => setSlot(row.slot, e.target.value)}
            className="shrink-0 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1 shadow-well cursor-pointer min-w-[10rem]"
          >
            {options.length === 0 && (
              <option value={slots[row.slot]}>{slots[row.slot]} (not in catalog)</option>
            )}
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
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
              <span className="font-mono uppercase tracking-wider text-xs font-semibold text-ink">
                {row.label}
              </span>
              <span className="text-9 font-mono px-1.5 py-0.5 rounded bg-veil-3 text-[#38bdf8]">
                main
              </span>
            </div>
          </div>
          <select
            data-testid={`select-${row.slot}`}
            value={slots[row.slot]}
            onChange={(e) => setSlot(row.slot, e.target.value)}
            className="shrink-0 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well cursor-pointer min-w-[13rem]"
          >
            {options.length === 0 && (
              <option value={slots[row.slot]}>{slots[row.slot]} (not in catalog)</option>
            )}
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-9 font-mono uppercase tracking-wider text-[#556985]">
            Signing key
          </span>
          <span className="text-10 font-mono text-ink" data-testid="chat-key-choice">
            {mode === 'vps'
              ? 'server vault'
              : chatKeyChoice === 'auto'
                ? 'auto (first filled Gemini key)'
                : KEY_SLOT_INFO[chatKeyChoice as KeySlotId]?.label ?? chatKeyChoice}
          </span>
          {mode !== 'vps' && bothGeminiKeys && (
            <button
              onClick={swapChatKey}
              data-testid="swap-chat-key"
              className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-10 font-mono text-[#38bdf8] shadow-well cursor-pointer"
            >
              {chatKeyChoice === 'gemini-paid' ? 'Use Free key' : 'Use Paid key'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <section>
        <div className="text-9 font-mono uppercase tracking-wider text-[#556985] px-1 mb-1.5">
          Chat
        </div>
        {SLOT_ROWS.filter((r) => r.group === 'chat').map(renderRow)}
      </section>

      <section>
        <div className="text-9 font-mono uppercase tracking-wider text-[#556985] px-1 mb-1.5">
          Workhorse
        </div>
        <div className="space-y-1">{SLOT_ROWS.filter((r) => r.group === 'workhorse').map(renderRow)}</div>
      </section>

      <section>
        <div className="text-9 font-mono uppercase tracking-wider text-[#556985] px-1 mb-1.5">
          Infrastructure
        </div>
        <div className="space-y-1">{SLOT_ROWS.filter((r) => r.group === 'infra').map(renderRow)}</div>
      </section>
    </>
  );
};

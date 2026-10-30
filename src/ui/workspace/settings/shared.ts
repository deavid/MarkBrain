/**
 * Shared pieces for the Model Settings tabs: the slot roster, catalog typing,
 * and the small helpers every tab borrows.
 */
import type { ModelSlot } from '../../../data/modelConfig';
import { KEY_SLOTS } from '../../../data/keySlots';
import type { KeySlotId } from '../../../data/keySlots';

export interface ModalCatalogEntry {
  id: string;
  name: string;
  capabilities?: string[];
  available?: boolean;
}

export interface SlotRow {
  slot: ModelSlot;
  label: string;
  group: 'chat' | 'workhorse' | 'infra';
}

export const SLOT_ROWS: SlotRow[] = [
  { slot: 'chat', label: 'Chat', group: 'chat' },
  { slot: 'extract', label: 'Extract', group: 'workhorse' },
  { slot: 'summarize', label: 'Summarize', group: 'workhorse' },
  { slot: 'qaGen', label: 'Q&A gen', group: 'workhorse' },
  { slot: 'title', label: 'Titles', group: 'workhorse' },
  { slot: 'embed', label: 'Embeddings', group: 'infra' },
  { slot: 'tts', label: 'Read-aloud', group: 'infra' },
];

export function optionsFor(slot: ModelSlot, catalog: ModalCatalogEntry[]): ModalCatalogEntry[] {
  return catalog.filter((m) => !m.capabilities || m.capabilities.includes(slot));
}

export function keySlotPlaceholder(id: KeySlotId): string {
  return id.startsWith('openrouter') ? 'sk-or-…' : 'AIza…';
}

/** Slot-shaped records are built from KEY_SLOTS so the 4-slot split (design-docs/24 §1) can't drift. */
export const emptyKeyRecord = (): Record<KeySlotId, string> =>
  Object.fromEntries(KEY_SLOTS.map((id) => [id, ''])) as Record<KeySlotId, string>;
export const emptyShownRecord = (): Record<KeySlotId, boolean> =>
  Object.fromEntries(KEY_SLOTS.map((id) => [id, false])) as Record<KeySlotId, boolean>;

/** Honest tier copy (David 2026-10-25): tier is account-wide, not chat-only. */
export const TIER_HINT =
  'PAID signs every lane — chat, extract, titles, embeddings, TTS — with the Paid key. FREE prefers the free key.';
export const HINT_VPS = TIER_HINT;
export const HINT_LOCAL = TIER_HINT;

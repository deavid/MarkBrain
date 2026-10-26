import React, { useEffect, useState } from 'react';
import { X, Settings2, KeyRound, Eye, EyeOff, Check, Users, Lock, Unlock, Plus, Shield } from 'lucide-react';
import { logger } from '../../utils/logger';
import {
  models as fetchModels,
  getAccountSettings,
  putAccountSettings,
  putAccountKeys,
  authUnlock,
  listAdminUsers,
  createAdminUser,
  patchAdminUser,
  type AccountSettingsResponse,
  type AdminUserRow,
} from '../../gateway/api';
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
import {
  hasSavedLocalVault,
  isLocalVaultUnlocked,
  createOrResetLocalVault,
  unlockLocalVault,
  lockLocalVault,
  destroyLocalVault,
  getVaultChatTier,
  setVaultChatTier,
} from '../../data/localKeyVault';
import { getWorkspaceMode, getVpsSession, patchVpsSession } from '../../services/workspaceSession';

/**
 * ModelSettingsModal — capability slots + Keys vault + Owner users
 * (design-docs/16 §3.1, D2/D7; 21C §4).
 *
 * Models tab: one model per lane, writes straight to the mode-scoped
 * localStorage slot — next request on that lane picks it up.
 *
 * Keys tab dispatches by workspace mode:
 * - local: WebCrypto passphrase vault (create / unlock / slots / lock).
 * - vps:   server account vault (unlock password / configured hints / tier).
 *
 * Users tab: Owner Account #1 only, rendered only in Connected VPS mode.
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
  return id.startsWith('openrouter') ? 'sk-or-…' : 'AIza…';
}

/** Slot-shaped records are built from KEY_SLOTS so the 4-slot split (design-docs/24 §1) can't drift. */
const emptyKeyRecord = (): Record<KeySlotId, string> =>
  Object.fromEntries(KEY_SLOTS.map((id) => [id, ''])) as Record<KeySlotId, string>;
const emptyShownRecord = (): Record<KeySlotId, boolean> =>
  Object.fromEntries(KEY_SLOTS.map((id) => [id, false])) as Record<KeySlotId, boolean>;

/** Honest tier copy (David 2026-10-25): tier is account-wide, not chat-only. */
const TIER_HINT =
  'PAID signs every lane — chat, extract, titles, embeddings, TTS — with the Paid key. FREE prefers the free key.';
const HINT_VPS = TIER_HINT;
const HINT_LOCAL = TIER_HINT;

export const ModelSettingsModal: React.FC<ModelSettingsModalProps> = ({ isOpen, onClose, catalog }) => {
  const [slots, setSlots] = useState<ModelSlotConfig>(DEFAULT_MODEL_SLOTS);
  const [liveCatalog, setLiveCatalog] = useState<ModalCatalogEntry[]>(catalog);
  const [keyValues, setKeyValues] = useState<Record<KeySlotId, string>>(emptyKeyRecord);
  const [shownKeys, setShownKeys] = useState<Record<KeySlotId, boolean>>(emptyShownRecord);
  const [laneKeys, setLaneKeys] = useState<Record<string, LaneKeyChoice>>({});
  const [tab, setTab] = useState<'models' | 'keys' | 'users'>('models');
  const [mode, setMode] = useState<'local' | 'vps'>('local');

  // ── local vault state ──
  const [localVaultState, setLocalVaultState] = useState<'none' | 'locked' | 'unlocked'>('none');
  const [localPassphrase, setLocalPassphrase] = useState('');
  const [localVaultError, setLocalVaultError] = useState<string | null>(null);
  const [localChatTier, setLocalChatTierState] = useState<'free' | 'paid'>('free');

  // ── vps vault state ──
  const [vpsSettings, setVpsSettings] = useState<AccountSettingsResponse | null>(null);
  const [vpsUnlockPw, setVpsUnlockPw] = useState('');
  const [vpsKeysError, setVpsKeysError] = useState<string | null>(null);
  const [vpsSlotDrafts, setVpsSlotDrafts] = useState<Record<KeySlotId, string>>(emptyKeyRecord);

  // ── users (owner) state ──
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [usersError, setUsersError] = useState<string | null>(null);
  const [resetPwFor, setResetPwFor] = useState<number | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');

  const isOwner = mode === 'vps' && getVpsSession()?.isOwner === true;

  const refreshLocalVaultState = () => {
    setLocalVaultState(
      !hasSavedLocalVault() ? 'none' : isLocalVaultUnlocked() ? 'unlocked' : 'locked'
    );
  };

  const refreshKeyValues = () => {
    const filled = emptyKeyRecord();
    for (const id of KEY_SLOTS) filled[id] = getKeySlot(id) ?? '';
    setKeyValues(filled);
  };

  const loadVpsSettings = () => {
    getAccountSettings()
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as AccountSettingsResponse;
        setVpsSettings(data);
        patchVpsSession({ vaultUnlocked: data.vaultUnlocked });
        if (!data.vaultUnlocked) setVpsKeysError('Server vault is locked — enter your password.');
      })
      .catch(() => setVpsKeysError('Could not reach the server account settings.'));
  };

  const loadUsers = () => {
    listAdminUsers()
      .then(async (res) => {
        if (!res.ok) {
          setUsersError(res.status === 403 ? 'Owner access required.' : `Failed to load users (HTTP ${res.status}).`);
          setUsers(null);
          return;
        }
        const data = (await res.json()) as { users: AdminUserRow[] };
        setUsers(data.users);
      })
      .catch(() => setUsersError('Could not reach the server.'));
  };

  useEffect(() => {
    if (!isOpen) return;
    setMode(getWorkspaceMode() ?? 'local');
    setTab('models');
    setSlots(loadModelConfig());
    setLaneKeys(loadLaneKeys());
    refreshKeyValues();
    refreshLocalVaultState();
    setLocalChatTierState(hasSavedLocalVault() && isLocalVaultUnlocked() ? getVaultChatTier() : 'free');
    let alive = true;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Lazy loads when a tab opens.
  useEffect(() => {
    if (!isOpen) return;
    if (tab === 'keys' && mode === 'vps') loadVpsSettings();
    if (tab === 'users' && isOwner) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tab, mode]);

  if (!isOpen) return null;

  const setSlot = (slot: ModelSlot, modelId: string) => {
    const next = { ...slots, [slot]: modelId };
    setSlots(next);
    saveModelConfig(next);
    logger.action('ModelSettings', `Slot ${slot} → ${modelId}`);
  };

  const commitKey = (id: KeySlotId, value: string) => {
    setKeyValues((prev) => ({ ...prev, [id]: value }));
    setKeySlot(id, value); // local vault RAM + envelope re-seal
    logger.action('ModelSettings', `Key slot ${id} ${value.trim() ? 'stored' : 'cleared'}`);
  };

  const toggleShown = (id: KeySlotId) =>
    setShownKeys((prev) => ({ ...prev, [id]: !prev[id] }));

  /** D8: one-click Free↔Paid flip for a lane, only when both keys exist. */
  const swapChatKey = () => {
    const current = laneKeys.chat ?? 'auto';
    const next: LaneKeyChoice = current === 'gemini-paid' ? 'gemini-free' : 'gemini-paid';
    setLaneKeys((prev) => ({ ...prev, chat: next }));
    setLaneKey('chat', next);
    logger.action('ModelSettings', `Chat lane key → ${next}`);
  };

  const chatKeyChoice = laneKeys.chat ?? 'auto';
  const bothGeminiKeys = getKeySlot('gemini-free') !== null && getKeySlot('gemini-paid') !== null;

  /* ── local vault actions ─────────────────────────────────────────────── */

  const handleCreateVault = async () => {
    setLocalVaultError(null);
    try {
      await createOrResetLocalVault(localPassphrase);
      setLocalPassphrase('');
      refreshLocalVaultState();
      refreshKeyValues();
      logger.action('ModelSettings', 'Local key vault created');
    } catch (err) {
      setLocalVaultError(err instanceof Error ? err.message : 'Could not create the vault.');
    }
  };

  const handleUnlockVault = async () => {
    setLocalVaultError(null);
    const ok = await unlockLocalVault(localPassphrase);
    if (!ok) {
      setLocalVaultError('Wrong passphrase — vault stays locked.');
      return;
    }
    setLocalPassphrase('');
    refreshLocalVaultState();
    refreshKeyValues();
    setLocalChatTierState(getVaultChatTier());
    logger.action('ModelSettings', 'Local key vault unlocked');
  };

  const handleResetVault = () => {
    destroyLocalVault();
    setLocalPassphrase('');
    setLocalVaultError(null);
    refreshLocalVaultState();
    refreshKeyValues();
    logger.action('ModelSettings', 'Local key vault destroyed');
  };

  const handleLockVault = () => {
    lockLocalVault();
    refreshLocalVaultState();
    refreshKeyValues();
    logger.action('ModelSettings', 'Local key vault locked');
  };

  const handleLocalTier = async (tier: 'free' | 'paid') => {
    setLocalChatTierState(tier);
    if (isLocalVaultUnlocked()) await setVaultChatTier(tier);
    logger.action('ModelSettings', `Local chat tier → ${tier}`);
  };

  /* ── vps vault actions ───────────────────────────────────────────────── */

  const handleVpsUnlock = async () => {
    setVpsKeysError(null);
    const res = await authUnlock(vpsUnlockPw);
    if (!res.ok) {
      setVpsKeysError('Wrong password — vault stays locked.');
      return;
    }
    setVpsUnlockPw('');
    loadVpsSettings();
    logger.action('ModelSettings', 'VPS vault unlocked');
  };

  const handleVpsSaveKey = async (id: KeySlotId) => {
    setVpsKeysError(null);
    const value = vpsSlotDrafts[id].trim();
    if (!value) return;
    const res = await putAccountKeys(id, value);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setVpsKeysError(body?.error ?? `Save failed (HTTP ${res.status}).`);
      return;
    }
    setVpsSlotDrafts((prev) => ({ ...prev, [id]: '' }));
    loadVpsSettings();
    logger.action('ModelSettings', `VPS key slot ${id} saved`);
  };

  const handleVpsClearKey = async (id: KeySlotId) => {
    setVpsKeysError(null);
    const res = await putAccountKeys(id, null);
    if (res.ok) loadVpsSettings();
    logger.action('ModelSettings', `VPS key slot ${id} cleared`);
  };

  const handleVpsTier = async (tier: 'free' | 'paid') => {
    const res = await putAccountSettings({ chatTier: tier });
    if (res.ok) loadVpsSettings();
    logger.action('ModelSettings', `VPS chat tier → ${tier}`);
  };

  /* ── users actions ───────────────────────────────────────────────────── */

  const handleAddUser = async () => {
    setUsersError(null);
    if (!newUserEmail.trim() || newUserPassword.length < 8) {
      setUsersError('Email and a password of at least 8 characters are required.');
      return;
    }
    const res = await createAdminUser(newUserEmail.trim(), newUserPassword);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setUsersError(body?.error ?? `Create failed (HTTP ${res.status}).`);
      return;
    }
    setNewUserEmail('');
    setNewUserPassword('');
    loadUsers();
    logger.action('ModelSettings', 'Admin created a user');
  };

  const handleToggleUser = async (u: AdminUserRow) => {
    setUsersError(null);
    const res = await patchAdminUser(u.id, { enabled: !u.enabled });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setUsersError(body?.error ?? `Update failed (HTTP ${res.status}).`);
      return;
    }
    loadUsers();
    logger.action('ModelSettings', `Admin ${u.enabled ? 'disabled' : 'enabled'} ${u.email}`);
  };

  const handleResetPassword = async (u: AdminUserRow) => {
    setUsersError(null);
    if (resetPwValue.length < 8) {
      setUsersError('New password must be at least 8 characters.');
      return;
    }
    const res = await patchAdminUser(u.id, { password: resetPwValue });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setUsersError(body?.error ?? `Reset failed (HTTP ${res.status}).`);
      return;
    }
    setResetPwFor(null);
    setResetPwValue('');
    logger.action('ModelSettings', `Admin reset password for ${u.email}`);
  };

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
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-veil-3 text-[#38bdf8]">
                main
              </span>
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
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-[#556985]">
            Signing key
          </span>
          <span className="text-[10px] font-mono text-ink" data-testid="chat-key-choice">
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
              className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[10px] font-mono text-[#38bdf8] shadow-well cursor-pointer"
            >
              {chatKeyChoice === 'gemini-paid' ? 'Use Free key' : 'Use Paid key'}
            </button>
          )}
        </div>
      </div>
    );
  };

  const tabs: Array<'models' | 'keys' | 'users'> = isOwner
    ? ['models', 'keys', 'users']
    : ['models', 'keys'];

  const renderKeysTab = () => {
    if (mode === 'vps') {
      if (!vpsSettings || !vpsSettings.vaultUnlocked) {
        return (
          <section className="rounded-xl bg-recess-1 p-3" data-testid="vps-vault-locked">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-mute mb-2">
              <Lock className="w-3.5 h-3.5 text-[#e0b96c]" />
              Server vault locked
            </div>
            <p className="text-[11px] text-[#788fa8] leading-relaxed mb-3">
              Server session keys are locked after a restart. Enter your password to unlock.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                data-testid="vps-vault-unlock-password"
                autoComplete="current-password"
                placeholder="Password"
                value={vpsUnlockPw}
                onChange={(e) => setVpsUnlockPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && vpsUnlockPw.trim()) {
                    e.preventDefault();
                    void handleVpsUnlock();
                  }
                }}
                className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 shadow-well"
              />
              <button
                onClick={handleVpsUnlock}
                data-testid="vps-vault-unlock"
                className="px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-[11px] font-mono cursor-pointer"
              >
                Unlock
              </button>
            </div>
            {vpsKeysError && <p className="text-[10px] text-red-400 mt-2">{vpsKeysError}</p>}
          </section>
        );
      }
      const keys = vpsSettings.keys;
      const tier = vpsSettings.chatTier;
      return (
        <section className="rounded-xl bg-recess-1 p-3" data-testid="vps-keys-panel">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-mute">
            <KeyRound className="w-3.5 h-3.5 text-[#e0b96c]" />
            Keys
          </div>
          <p className="text-[11px] text-[#788fa8] leading-relaxed mt-1.5 mb-3">
            Synced across all devices signed into {getVpsSession()?.email ?? 'your account'}.
            Encrypted at rest on the server.
          </p>

          <div className="space-y-2">
            {KEY_SLOTS.map((id) => {
              const info = keys[id] ?? { configured: false, hint: null };
              return (
                <div key={id} data-testid={`key-slot-${id}`} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[10px] font-mono text-ink-mute">
                    {KEY_SLOT_INFO[id].label}
                  </span>
                  <span
                    className="w-32 shrink-0 text-[10px] font-mono text-ink"
                    data-testid={`vps-key-status-${id}`}
                  >
                    {info.configured ? `Configured (${info.hint})` : 'Not set'}
                  </span>
                  <input
                    type={shownKeys[id] ? 'text' : 'password'}
                    value={vpsSlotDrafts[id]}
                    onChange={(e) =>
                      setVpsSlotDrafts((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                    placeholder={keySlotPlaceholder(id)}
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 pr-8 shadow-well"
                  />
                  <button
                    onClick={() => toggleShown(id)}
                    title={shownKeys[id] ? 'Hide key' : 'Show key'}
                    className="text-ink-mute hover:text-ink cursor-pointer"
                  >
                    {shownKeys[id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => handleVpsSaveKey(id)}
                    data-testid={`vps-key-save-${id}`}
                    className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[10px] font-mono text-[#38bdf8] shadow-well cursor-pointer"
                  >
                    Save
                  </button>
                  {info.configured && (
                    <button
                      onClick={() => handleVpsClearKey(id)}
                      data-testid={`vps-key-clear-${id}`}
                      className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[10px] font-mono text-[#f28894] shadow-well cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2 mt-3">
            <span className="text-[9px] font-mono uppercase tracking-wider text-[#556985]">
              Key tier
            </span>
            <div className="flex rounded-lg overflow-hidden shadow-well" data-testid="vps-chat-tier">
              {(['free', 'paid'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => handleVpsTier(t)}
                  className={`px-2.5 py-1 text-[10px] font-mono uppercase cursor-pointer ${
                    tier === t ? 'bg-brand/90 text-white' : 'bg-surface-3 text-ink-mute hover:text-ink'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-[#788fa8] font-mono mt-1.5">
            {HINT_VPS}
          </p>
          {vpsKeysError && <p className="text-[10px] text-red-400 mt-2">{vpsKeysError}</p>}
        </section>
      );
    };

    // ── local mode ──
    if (localVaultState === 'none') {
      return (
        <section className="rounded-xl bg-recess-1 p-3" data-testid="local-vault-create">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-mute mb-2">
            <KeyRound className="w-3.5 h-3.5 text-[#e0b96c]" />
            Local key vault
          </div>
          <p className="text-[11px] text-[#788fa8] leading-relaxed mb-3">
            Set a passphrase to encrypt your API keys on this device.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="password"
              data-testid="local-vault-passphrase"
              autoComplete="new-password"
              placeholder="Passphrase"
              value={localPassphrase}
              onChange={(e) => setLocalPassphrase(e.target.value)}
              className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 shadow-well"
            />
            <button
              onClick={handleCreateVault}
              data-testid="local-vault-create-submit"
              className="px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-[11px] font-mono cursor-pointer"
            >
              Create Vault
            </button>
          </div>
          {localVaultError && <p className="text-[10px] text-red-400 mt-2">{localVaultError}</p>}
        </section>
      );
    }

    if (localVaultState === 'locked') {
      return (
        <section className="rounded-xl bg-recess-1 p-3" data-testid="local-vault-locked">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-mute mb-2">
            <Lock className="w-3.5 h-3.5 text-[#e0b96c]" />
            Your local key vault is locked
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              data-testid="local-vault-passphrase"
              autoComplete="current-password"
              placeholder="Passphrase"
              value={localPassphrase}
              onChange={(e) => setLocalPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleUnlockVault();
              }}
              className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 shadow-well"
            />
            <button
              onClick={handleUnlockVault}
              data-testid="local-vault-unlock"
              className="px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-[11px] font-mono cursor-pointer"
            >
              Unlock
            </button>
          </div>
          <button
            onClick={handleResetVault}
            data-testid="local-vault-reset"
            className="text-[10px] font-mono text-[#f28894] hover:underline mt-2 cursor-pointer"
          >
            Reset vault (forgotten passphrase — existing keys become unreadable)
          </button>
          {localVaultError && <p className="text-[10px] text-red-400 mt-2">{localVaultError}</p>}
        </section>
      );
    }

    // unlocked
    return (
      <section className="rounded-xl bg-recess-1 p-3" data-testid="local-vault-unlocked">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-ink-mute">
          <span className="flex items-center gap-2">
            <Unlock className="w-3.5 h-3.5 text-emerald-400" />
            Keys — encrypted on this device
          </span>
          <button
            onClick={handleLockVault}
            data-testid="local-vault-lock"
            className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[10px] font-mono text-ink normal-case cursor-pointer"
          >
            Lock now
          </button>
        </div>
        <p className="text-[11px] text-[#788fa8] leading-relaxed mt-1.5 mb-3">
          Stored in this browser only, encrypted with your passphrase — never plaintext.
          Empty slots are fine; those lanes will tell you a key is missing.
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
                  className="w-full rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 pr-8 shadow-well"
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
        <div className="flex items-center gap-2 mt-3">
          <span className="text-[9px] font-mono uppercase tracking-wider text-[#556985]">
            Key tier
          </span>
          <div className="flex rounded-lg overflow-hidden shadow-well" data-testid="local-chat-tier">
            {(['free', 'paid'] as const).map((t) => (
              <button
                key={t}
                onClick={() => void handleLocalTier(t)}
                className={`px-2.5 py-1 text-[10px] font-mono uppercase cursor-pointer ${
                  localChatTier === t
                    ? 'bg-brand/90 text-white'
                    : 'bg-surface-3 text-ink-mute hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-[#788fa8] font-mono mt-1.5">
          {HINT_LOCAL}
        </p>
        {listFilledKeySlots().length === 0 && (
          <p className="text-[10px] text-[#788fa8] font-mono mt-2">
            No keys configured — add one to talk to a model from this device.
          </p>
        )}
      </section>
    );
  };

  const renderUsersTab = () => (
    <section className="rounded-xl bg-recess-1 p-3" data-testid="users-panel">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-ink-mute mb-3">
        <Users className="w-3.5 h-3.5 text-[#38bdf8]" />
        Users
      </div>

      <div className="flex items-center gap-2 mb-3">
        <input
          type="email"
          placeholder="Email"
          value={newUserEmail}
          onChange={(e) => setNewUserEmail(e.target.value)}
          className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 shadow-well"
        />
        <input
          type="password"
          placeholder="Initial password"
          autoComplete="new-password"
          value={newUserPassword}
          onChange={(e) => setNewUserPassword(e.target.value)}
          className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-[11px] px-2 py-1.5 shadow-well"
        />
        <button
          onClick={handleAddUser}
          data-testid="admin-add-user-submit"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-[11px] font-mono cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          Add User
        </button>
      </div>

      {usersError && <p className="text-[10px] text-red-400 mb-2">{usersError}</p>}

      <div className="space-y-1.5">
        {users === null && <p className="text-[11px] text-ink-mute">Loading users…</p>}
        {users?.map((u) => (
          <div
            key={u.id}
            data-testid={`admin-user-row-${u.id}`}
            className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5"
          >
            <span className="flex-1 text-[11px] font-mono text-ink truncate">{u.email}</span>
            {u.isOwner && (
              <span className="flex items-center gap-1 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-veil-3 text-[#e0b96c]">
                <Shield className="w-3 h-3" />
                Owner
              </span>
            )}
            <span
              className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded ${
                u.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
              }`}
            >
              {u.enabled ? 'Enabled' : 'Disabled'}
            </span>
            {!u.isOwner && (
              <>
                <button
                  onClick={() => void handleToggleUser(u)}
                  data-testid={`admin-toggle-${u.id}`}
                  className="px-2 py-0.5 rounded bg-veil-2 hover:bg-veil-3 text-[10px] font-mono text-ink cursor-pointer"
                >
                  {u.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => {
                    setResetPwFor(resetPwFor === u.id ? null : u.id);
                    setResetPwValue('');
                  }}
                  data-testid={`admin-reset-open-${u.id}`}
                  className="px-2 py-0.5 rounded bg-veil-2 hover:bg-veil-3 text-[10px] font-mono text-[#8ab1e0] cursor-pointer"
                >
                  Reset Password
                </button>
              </>
            )}
            {resetPwFor === u.id && (
              <div className="flex items-center gap-1 w-full">
                <input
                  type="password"
                  placeholder="New password"
                  autoComplete="new-password"
                  value={resetPwValue}
                  onChange={(e) => setResetPwValue(e.target.value)}
                  className="flex-1 rounded bg-surface-3 text-ink font-mono text-[10px] px-2 py-1 shadow-well"
                />
                <button
                  onClick={() => void handleResetPassword(u)}
                  data-testid={`admin-reset-submit-${u.id}`}
                  className="px-2 py-1 rounded bg-brand/90 text-white text-[10px] font-mono cursor-pointer"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

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
            {tabs.map((t) => (
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
                {t === 'models' ? 'Models' : t === 'keys' ? 'Keys' : 'Users'}
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

          {tab === 'keys' && renderKeysTab()}
          {tab === 'users' && isOwner && renderUsersTab()}
        </div>
      </div>
    </div>
  );
};

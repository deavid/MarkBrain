import React, { useEffect, useState } from 'react';
import { X, Settings2, KeyRound, Eye, EyeOff, Check, Users, Lock, Unlock, Plus, Shield } from 'lucide-react';
import { logger } from '../../utils/logger';
import {
  models as fetchModels,
  getAccountSettings,
  putAccountSettings,
  putAccountKeys,
  changeAccountPassword,
  authUnlock,
  listAdminUsers,
  createAdminUser,
  patchAdminUser,
  type AccountSettingsResponse,
  type AdminUserRow,
} from '../../gateway/api';
import { isOfflineReplica } from '../../services/workspaceSession';
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
import { rememberReArmKey, setVaultLocked } from '../../data/vaultReArm';
import { requestSyncNow } from '../../application/syncBus';
import { getWorkspaceMode, getVpsSession, patchVpsSession } from '../../services/workspaceSession';

/**
 * ModelSettingsModal — capability slots + Keys vault + Owner users
 * (design-docs/16 §3.1, D2/D7; 21C §4). The tab bodies live in
 * `src/ui/workspace/settings/` (ModelSlotsTab, KeyVaultTab, AccountAdminTab);
 * this file owns their state, the effects that load it, and the shell.
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
  /** Tab to land on when opened programmatically (design 25 §1.1). */
  initialTab?: 'models' | 'keys' | 'users';
  /** Catalog as currently known by App (sidebar list). A fresh fetch runs on open. */
  catalog: Array<{
    id: string;
    name: string;
    capabilities?: string[];
    available?: boolean;
  }>;
}


import { emptyKeyRecord, emptyShownRecord } from './settings/shared';
import type { ModalCatalogEntry } from './settings/shared';
import { ModelSlotsTab } from './settings/ModelSlotsTab';
import { KeyVaultTab } from './settings/KeyVaultTab';
import { AccountAdminTab } from './settings/AccountAdminTab';

export const ModelSettingsModal: React.FC<ModelSettingsModalProps> = ({ isOpen, onClose, catalog, initialTab }) => {
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

  // ── vps password change state ──
  const [vpsPwCurrent, setVpsPwCurrent] = useState('');
  const [vpsPwNew, setVpsPwNew] = useState('');
  const [vpsPwConfirm, setVpsPwConfirm] = useState('');
  const [vpsPwMsg, setVpsPwMsg] = useState<string | null>(null);
  const [vpsPwOk, setVpsPwOk] = useState(false);

  // ── users (owner) state ──
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [usersError, setUsersError] = useState<string | null>(null);
  const [resetPwFor, setResetPwFor] = useState<number | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');

  const isOwner = mode === 'vps' && getVpsSession()?.isOwner === true;
  // Offline replica: read-only mirror — the server-backed tabs (keys, users)
  // have nothing to say offline, so they don't render at all.
  const offlineReplica = isOfflineReplica();

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
    setTab(initialTab ?? 'models');
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
    if (tab === 'keys' && mode === 'vps' && !isOfflineReplica()) loadVpsSettings();
    if (tab === 'users' && isOwner && !isOfflineReplica()) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tab, mode]);

  if (!isOpen) return null;

  const setSlot = (slot: ModelSlot, modelId: string) => {
    const next = { ...slots, [slot]: modelId };
    setSlots(next);
    saveModelConfig(next);
    if (slot === 'embed' && modelId !== slots.embed) {
      // §3.4: vectors from different embedding models are NOT comparable —
      // switching rebuilds the whole search index (everything reads as stale
      // until re-embedded). The user picks the slot, the cost is told here.
      logger.action('ModelSettings', `Slot embed → ${modelId}: the search index will be fully re-embedded`);
    }
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
    setVaultLocked(false);
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
    setVaultLocked(true);
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
    try {
      const body = (await res.json()) as { rearmKey?: string };
      rememberReArmKey(body.rearmKey);
    } catch {
      /* body already consumed elsewhere — re-arm just won't be available */
    }
    setVaultLocked(false);
    setVpsUnlockPw('');
    loadVpsSettings();
    logger.action('ModelSettings', 'VPS vault unlocked');
    // Confirm the fresh server state NOW — not on the next 10s poll.
    requestSyncNow();
  };

  const handleVpsPasswordChange = async () => {
    setVpsPwMsg(null);
    if (!vpsPwCurrent || vpsPwNew.length < 8 || vpsPwNew !== vpsPwConfirm) {
      setVpsPwOk(false);
      setVpsPwMsg('Fill in the current password and a new one (8+ characters, twice).');
      return;
    }
    const res = await changeAccountPassword(vpsPwCurrent, vpsPwNew);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setVpsPwOk(false);
      setVpsPwMsg(body?.error ?? `Change failed (HTTP ${res.status}).`);
      return;
    }
    const body = (await res.json()) as { keysPreserved?: boolean; rearmKey?: string };
    rememberReArmKey(body.rearmKey);
    setVpsPwCurrent('');
    setVpsPwNew('');
    setVpsPwConfirm('');
    setVaultLocked(false);
    setVpsPwOk(true);
    requestSyncNow();
    setVpsPwMsg(
      body.keysPreserved === false
        ? 'Password changed — saved API keys could not be carried over. Re-enter them below.'
        : 'Password changed — saved API keys carried over.'
    );
    loadVpsSettings();
    logger.action('ModelSettings', 'Changed account password');
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


  const tabs: Array<'models' | 'keys' | 'users'> = offlineReplica
    ? ['models']
    : mode === 'vps'
      ? ['models', 'keys', 'users'] // every signed-in account: password lives in Users
      : ['models', 'keys'];

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
              <p className="text-10 text-[#6b82a3]">
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
                className={`flex-1 min-h-[28px] rounded-lg text-11 font-mono uppercase tracking-wider transition-colors cursor-pointer ${
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
            <ModelSlotsTab
              slots={slots}
              liveCatalog={liveCatalog}
              setSlot={setSlot}
              mode={mode}
              chatKeyChoice={chatKeyChoice}
              bothGeminiKeys={bothGeminiKeys}
              swapChatKey={swapChatKey}
            />
          )}

          {tab === 'keys' && (
            <KeyVaultTab
              mode={mode}
              vpsSettings={vpsSettings}
              vpsKeysError={vpsKeysError}
              vpsUnlockPw={vpsUnlockPw}
              setVpsUnlockPw={setVpsUnlockPw}
              handleVpsUnlock={handleVpsUnlock}
              vpsSlotDrafts={vpsSlotDrafts}
              setVpsSlotDrafts={setVpsSlotDrafts}
              handleVpsSaveKey={handleVpsSaveKey}
              handleVpsClearKey={handleVpsClearKey}
              handleVpsTier={handleVpsTier}
              shownKeys={shownKeys}
              toggleShown={toggleShown}
              localVaultState={localVaultState}
              localPassphrase={localPassphrase}
              setLocalPassphrase={setLocalPassphrase}
              localVaultError={localVaultError}
              localChatTier={localChatTier}
              keyValues={keyValues}
              commitKey={commitKey}
              handleCreateVault={handleCreateVault}
              handleUnlockVault={handleUnlockVault}
              handleResetVault={handleResetVault}
              handleLockVault={handleLockVault}
              handleLocalTier={handleLocalTier}
            />
          )}

          {tab === 'users' && isOwner && (
            <AccountAdminTab
              users={users}
              vpsPwCurrent={vpsPwCurrent}
              setVpsPwCurrent={setVpsPwCurrent}
              vpsPwNew={vpsPwNew}
              setVpsPwNew={setVpsPwNew}
              vpsPwConfirm={vpsPwConfirm}
              setVpsPwConfirm={setVpsPwConfirm}
              vpsPwMsg={vpsPwMsg}
              vpsPwOk={vpsPwOk}
              handleVpsPasswordChange={handleVpsPasswordChange}
              newUserEmail={newUserEmail}
              setNewUserEmail={setNewUserEmail}
              newUserPassword={newUserPassword}
              setNewUserPassword={setNewUserPassword}
              usersError={usersError}
              handleAddUser={handleAddUser}
              handleToggleUser={handleToggleUser}
              handleResetPassword={handleResetPassword}
              resetPwFor={resetPwFor}
              setResetPwFor={setResetPwFor}
              resetPwValue={resetPwValue}
              setResetPwValue={setResetPwValue}
            />
          )}

        </div>
      </div>
    </div>
  );
};

/**
 * The Keys tab: the local WebCrypto passphrase vault (create / unlock / slots /
 * lock) in local mode, or the server account vault in VPS mode.
 */
import React from 'react';
import { KeyRound, Lock, Unlock, Eye, EyeOff, Check } from 'lucide-react';
import { KEY_SLOTS, KEY_SLOT_INFO, getKeySlot, listFilledKeySlots } from '../../../data/keySlots';
import type { KeySlotId } from '../../../data/keySlots';
import { keySlotPlaceholder, HINT_VPS, HINT_LOCAL } from './shared';
import { getVpsSession } from '../../../services/workspaceSession';

export interface KeyVaultTabProps {
  mode: 'local' | 'vps';
  // vps vault
  vpsSettings: import('../../../gateway/api').AccountSettingsResponse | null;
  vpsKeysError: string | null;
  vpsUnlockPw: string;
  setVpsUnlockPw: (pw: string) => void;
  handleVpsUnlock: () => void;
  vpsSlotDrafts: Record<KeySlotId, string>;
  setVpsSlotDrafts: React.Dispatch<React.SetStateAction<Record<KeySlotId, string>>>;
  handleVpsSaveKey: (id: KeySlotId) => void;
  handleVpsClearKey: (id: KeySlotId) => void;
  handleVpsTier: (tier: 'free' | 'paid') => void;
  // shared key-row display
  shownKeys: Record<KeySlotId, boolean>;
  toggleShown: (id: KeySlotId) => void;
  // local vault
  localVaultState: 'none' | 'locked' | 'unlocked';
  localPassphrase: string;
  setLocalPassphrase: (pw: string) => void;
  localVaultError: string | null;
  localChatTier: 'free' | 'paid';
  keyValues: Record<KeySlotId, string>;
  commitKey: (id: KeySlotId, value: string) => void;
  handleCreateVault: () => void;
  handleUnlockVault: () => void;
  handleResetVault: () => void;
  handleLockVault: () => void;
  handleLocalTier: (tier: 'free' | 'paid') => void;
}

export const KeyVaultTab: React.FC<KeyVaultTabProps> = ({
  mode,
  vpsSettings,
  vpsKeysError,
  vpsUnlockPw,
  setVpsUnlockPw,
  handleVpsUnlock,
  vpsSlotDrafts,
  setVpsSlotDrafts,
  handleVpsSaveKey,
  handleVpsClearKey,
  handleVpsTier,
  shownKeys,
  toggleShown,
  localVaultState,
  localPassphrase,
  setLocalPassphrase,
  localVaultError,
  localChatTier,
  keyValues,
  commitKey,
  handleCreateVault,
  handleUnlockVault,
  handleResetVault,
  handleLockVault,
  handleLocalTier,
}) => {
const renderKeysTab = () => {
  if (mode === 'vps') {
    if (!vpsSettings || !vpsSettings.vaultUnlocked) {
      return (
        <section className="rounded-xl bg-recess-1 p-3" data-testid="vps-vault-locked">
          <div className="flex items-center gap-2 text-10 font-mono uppercase tracking-wider text-ink-mute mb-2">
            <Lock className="w-3.5 h-3.5 text-[#e0b96c]" />
            Server vault locked
          </div>
          <p className="text-11 text-[#788fa8] leading-relaxed mb-3">
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
              className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well"
            />
            <button
              onClick={handleVpsUnlock}
              data-testid="vps-vault-unlock"
              className="px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-11 font-mono cursor-pointer"
            >
              Unlock
            </button>
          </div>
          {vpsKeysError && <p className="text-10 text-red-400 mt-2">{vpsKeysError}</p>}
        </section>
      );
    }
    const keys = vpsSettings.keys;
    const tier = vpsSettings.chatTier;
    return (
      <section className="rounded-xl bg-recess-1 p-3" data-testid="vps-keys-panel">
        <div className="flex items-center gap-2 text-10 font-mono uppercase tracking-wider text-ink-mute">
          <KeyRound className="w-3.5 h-3.5 text-[#e0b96c]" />
          Keys
        </div>
        <p className="text-11 text-[#788fa8] leading-relaxed mt-1.5 mb-3">
          Synced across all devices signed into {getVpsSession()?.email ?? 'your account'}.
          Encrypted at rest on the server.
        </p>

        <div className="space-y-2">
          {KEY_SLOTS.map((id) => {
            const info = keys[id] ?? { configured: false, hint: null };
            return (
              <div key={id} data-testid={`key-slot-${id}`} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-10 font-mono text-ink-mute">
                  {KEY_SLOT_INFO[id].label}
                </span>
                <span
                  className="w-32 shrink-0 text-10 font-mono text-ink"
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
                  className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 pr-8 shadow-well"
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
                  className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-10 font-mono text-[#38bdf8] shadow-well cursor-pointer"
                >
                  Save
                </button>
                {info.configured && (
                  <button
                    onClick={() => handleVpsClearKey(id)}
                    data-testid={`vps-key-clear-${id}`}
                    className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-10 font-mono text-[#f28894] shadow-well cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <span className="text-9 font-mono uppercase tracking-wider text-[#556985]">
            Key tier
          </span>
          <div className="flex rounded-lg overflow-hidden shadow-well" data-testid="vps-chat-tier">
            {(['free', 'paid'] as const).map((t) => (
              <button
                key={t}
                onClick={() => handleVpsTier(t)}
                className={`px-2.5 py-1 text-10 font-mono uppercase cursor-pointer ${
                  tier === t ? 'bg-brand/90 text-white' : 'bg-surface-3 text-ink-mute hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <p className="text-10 text-[#788fa8] font-mono mt-1.5">
          {HINT_VPS}
        </p>
        {vpsKeysError && <p className="text-10 text-red-400 mt-2">{vpsKeysError}</p>}

      </section>
    );
  };

  // ── local mode ──
  if (localVaultState === 'none') {
    return (
      <section className="rounded-xl bg-recess-1 p-3" data-testid="local-vault-create">
        <div className="flex items-center gap-2 text-10 font-mono uppercase tracking-wider text-ink-mute mb-2">
          <KeyRound className="w-3.5 h-3.5 text-[#e0b96c]" />
          Local key vault
        </div>
        <p className="text-11 text-[#788fa8] leading-relaxed mb-3">
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
            className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well"
          />
          <button
            onClick={handleCreateVault}
            data-testid="local-vault-create-submit"
            className="px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-11 font-mono cursor-pointer"
          >
            Create Vault
          </button>
        </div>
        {localVaultError && <p className="text-10 text-red-400 mt-2">{localVaultError}</p>}
      </section>
    );
  }

  if (localVaultState === 'locked') {
    return (
      <section className="rounded-xl bg-recess-1 p-3" data-testid="local-vault-locked">
        <div className="flex items-center gap-2 text-10 font-mono uppercase tracking-wider text-ink-mute mb-2">
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
            className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well"
          />
          <button
            onClick={handleUnlockVault}
            data-testid="local-vault-unlock"
            className="px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-11 font-mono cursor-pointer"
          >
            Unlock
          </button>
        </div>
        <button
          onClick={handleResetVault}
          data-testid="local-vault-reset"
          className="text-10 font-mono text-[#f28894] hover:underline mt-2 cursor-pointer"
        >
          Reset vault (forgotten passphrase — existing keys become unreadable)
        </button>
        {localVaultError && <p className="text-10 text-red-400 mt-2">{localVaultError}</p>}
      </section>
    );
  }

  // unlocked
  return (
    <section className="rounded-xl bg-recess-1 p-3" data-testid="local-vault-unlocked">
      <div className="flex items-center justify-between text-10 font-mono uppercase tracking-wider text-ink-mute">
        <span className="flex items-center gap-2">
          <Unlock className="w-3.5 h-3.5 text-emerald-400" />
          Keys — encrypted on this device
        </span>
        <button
          onClick={handleLockVault}
          data-testid="local-vault-lock"
          className="px-2 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-10 font-mono text-ink normal-case cursor-pointer"
        >
          Lock now
        </button>
      </div>
      <p className="text-11 text-[#788fa8] leading-relaxed mt-1.5 mb-3">
        Stored in this browser only, encrypted with your passphrase — never plaintext.
        Empty slots are fine; those lanes will tell you a key is missing.
      </p>
      <div className="space-y-2">
        {KEY_SLOTS.map((id) => (
          <div key={id} data-testid={`key-slot-${id}`} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-10 font-mono text-ink-mute">
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
                className="w-full rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 pr-8 shadow-well"
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
        <span className="text-9 font-mono uppercase tracking-wider text-[#556985]">
          Key tier
        </span>
        <div className="flex rounded-lg overflow-hidden shadow-well" data-testid="local-chat-tier">
          {(['free', 'paid'] as const).map((t) => (
            <button
              key={t}
              onClick={() => void handleLocalTier(t)}
              className={`px-2.5 py-1 text-10 font-mono uppercase cursor-pointer ${
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
      <p className="text-10 text-[#788fa8] font-mono mt-1.5">
        {HINT_LOCAL}
      </p>
      {listFilledKeySlots().length === 0 && (
        <p className="text-10 text-[#788fa8] font-mono mt-2">
          No keys configured — add one to talk to a model from this device.
        </p>
      )}
    </section>
  );
};

  return renderKeysTab();
};

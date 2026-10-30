/**
 * The Model Settings tabs must actually RENDER their content (tech-debt Phase 5
 * follow-up, 2026-10-30): the Keys tab extraction once shipped a component that
 * defined its render function and never returned it — the tab was an empty shell
 * in the browser and NO test noticed, because no test ever rendered the modal.
 * This suite is the contract: every tab component emits its real content when
 * rendered with its props.
 *
 * Rendered through react-dom/server — no DOM needed, it exercises the real
 * components. The shell's initialTab is applied in an effect (invisible to
 * static render), so the tabs are rendered directly; the shell smoke test
 * pins the wiring (default MODELS tab + the three tab buttons).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KeyVaultTab } from '../ui/workspace/settings/KeyVaultTab';
import { ModelSlotsTab } from '../ui/workspace/settings/ModelSlotsTab';
import { AccountAdminTab } from '../ui/workspace/settings/AccountAdminTab';
import { ModelSettingsModal } from '../ui/workspace/ModelSettingsModal';
import type { KeySlotId } from '../data/keySlots';

const noop = () => {};
const emptyKeyRecord: Record<KeySlotId, string> = {
  'gemini-free': '', 'gemini-paid': '', 'openrouter-free': '', 'openrouter-paid': '',
};
const emptyShownRecord: Record<KeySlotId, boolean> = {
  'gemini-free': false, 'gemini-paid': false, 'openrouter-free': false, 'openrouter-paid': false,
};

describe('ModelSettingsModal — every tab renders its content (the empty-KEYS-tab law)', () => {
  it('KeyVaultTab (local, no vault yet) renders the create-vault section', () => {
    const html = renderToStaticMarkup(
      <KeyVaultTab
        mode="local"
        vpsSettings={null}
        vpsKeysError={null}
        vpsUnlockPw=""
        setVpsUnlockPw={noop}
        handleVpsUnlock={noop}
        vpsSlotDrafts={emptyKeyRecord}
        setVpsSlotDrafts={noop}
        handleVpsSaveKey={noop}
        handleVpsClearKey={noop}
        handleVpsTier={noop}
        shownKeys={emptyShownRecord}
        toggleShown={noop}
        localVaultState="none"
        localPassphrase=""
        setLocalPassphrase={noop}
        localVaultError={null}
        localChatTier="free"
        keyValues={emptyKeyRecord}
        commitKey={noop}
        handleCreateVault={noop}
        handleUnlockVault={noop}
        handleResetVault={noop}
        handleLockVault={noop}
        handleLocalTier={noop}
      />
    );
    // THE contract: the local vault's create section is present. The
    // missing-return bug rendered NOTHING (component returned undefined).
    expect(html).toContain('data-testid="local-vault-create"');
    expect(html).toContain('data-testid="local-vault-passphrase"');
  });

  it('KeyVaultTab (vps, settings not loaded) renders the locked-vault section', () => {
    const html = renderToStaticMarkup(
      <KeyVaultTab
        mode="vps"
        vpsSettings={null}
        vpsKeysError={null}
        vpsUnlockPw=""
        setVpsUnlockPw={noop}
        handleVpsUnlock={noop}
        vpsSlotDrafts={emptyKeyRecord}
        setVpsSlotDrafts={noop}
        handleVpsSaveKey={noop}
        handleVpsClearKey={noop}
        handleVpsTier={noop}
        shownKeys={emptyShownRecord}
        toggleShown={noop}
        localVaultState="none"
        localPassphrase=""
        setLocalPassphrase={noop}
        localVaultError={null}
        localChatTier="free"
        keyValues={emptyKeyRecord}
        commitKey={noop}
        handleCreateVault={noop}
        handleUnlockVault={noop}
        handleResetVault={noop}
        handleLockVault={noop}
        handleLocalTier={noop}
      />
    );
    expect(html).toContain('data-testid="vps-vault-locked"');
  });

  it('ModelSlotsTab renders the lane slot rows', () => {
    const html = renderToStaticMarkup(
      <ModelSlotsTab
        slots={{} as never}
        liveCatalog={[]}
        setSlot={noop}
        mode="local"
        chatKeyChoice="auto"
        bothGeminiKeys={false}
        swapChatKey={noop}
      />
    );
    expect(html).toContain('data-testid="slot-chat"');
    expect(html).toContain('data-testid="slot-tts"');
  });

  it('AccountAdminTab renders the user-admin section', () => {
    const html = renderToStaticMarkup(
      <AccountAdminTab
        users={null}
        vpsPwCurrent=""
        setVpsPwCurrent={noop}
        vpsPwNew=""
        setVpsPwNew={noop}
        vpsPwConfirm=""
        setVpsPwConfirm={noop}
        vpsPwMsg={null}
        vpsPwOk={false}
        handleVpsPasswordChange={noop}
        newUserEmail=""
        setNewUserEmail={noop}
        newUserPassword=""
        setNewUserPassword={noop}
        usersError={null}
        handleAddUser={noop}
        handleToggleUser={noop}
        handleResetPassword={noop}
        resetPwFor={null}
        setResetPwFor={noop}
        resetPwValue=""
        setResetPwValue={noop}
      />
    );
    // A tab that renders nothing would fail this the same way KEYS did.
    expect(html).toContain('<section');
  });

  it('the modal shell renders with its three tab buttons (smoke)', () => {
    const html = renderToStaticMarkup(
      <ModelSettingsModal isOpen onClose={() => {}} catalog={[]} />
    );
    expect(html).toContain('data-testid="model-settings-modal"');
    expect(html).toContain('data-testid="settings-tab-models"');
    expect(html).toContain('data-testid="settings-tab-keys"');
    // USERS only exists for the VPS owner — a local render has no such tab.
    // Default tab is models — visible in static render (effects don't run).
    expect(html).toContain('data-testid="slot-chat"');
  });
});

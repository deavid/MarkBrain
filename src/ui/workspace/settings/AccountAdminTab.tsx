/**
 * The Users tab: the signed-in account's password change plus Owner Account #1's
 * user management, rendered only in Connected VPS mode.
 */
import React from 'react';
import { KeyRound, Plus, Shield, Users } from 'lucide-react';
import { getVpsSession } from '../../../services/workspaceSession';
import type { AdminUserRow } from '../../../gateway/api';

export interface AccountAdminTabProps {
  users: AdminUserRow[] | null;
  // password change (vps)
  vpsPwCurrent: string;
  setVpsPwCurrent: (pw: string) => void;
  vpsPwNew: string;
  setVpsPwNew: (pw: string) => void;
  vpsPwConfirm: string;
  setVpsPwConfirm: (pw: string) => void;
  vpsPwMsg: string | null;
  vpsPwOk: boolean;
  handleVpsPasswordChange: () => void;
  newUserEmail: string;
  setNewUserEmail: (email: string) => void;
  newUserPassword: string;
  setNewUserPassword: (pw: string) => void;
  usersError: string | null;
  handleAddUser: () => void;
  handleToggleUser: (u: AdminUserRow) => void;
  handleResetPassword: (u: AdminUserRow) => void;
  resetPwFor: number | null;
  setResetPwFor: (id: number | null) => void;
  resetPwValue: string;
  setResetPwValue: (pw: string) => void;
}

export const AccountAdminTab: React.FC<AccountAdminTabProps> = ({
  users,
  vpsPwCurrent,
  setVpsPwCurrent,
  vpsPwNew,
  setVpsPwNew,
  vpsPwConfirm,
  setVpsPwConfirm,
  vpsPwMsg,
  vpsPwOk,
  handleVpsPasswordChange,
  newUserEmail,
  setNewUserEmail,
  newUserPassword,
  setNewUserPassword,
  usersError,
  handleAddUser,
  handleToggleUser,
  handleResetPassword,
  resetPwFor,
  setResetPwFor,
  resetPwValue,
  setResetPwValue,
}) => {
  const isOwner = getVpsSession()?.isOwner === true;

  return (
    <section className="rounded-xl bg-recess-1 p-3" data-testid="users-panel">
      <div className="flex items-center gap-2 text-10 font-mono uppercase tracking-wider text-ink-mute mb-3">
        <Users className="w-3.5 h-3.5 text-[#38bdf8]" />
        Your account
      </div>

      {/* The signed-in account, read-only — accounts are managed on the server. */}
      <input
        type="email"
        data-testid="account-email"
        value={getVpsSession()?.email ?? ''}
        readOnly
        className="w-full h-10 rounded-lg bg-surface-0 border border-line px-3 text-13 text-ink font-mono mb-3 cursor-default"
      />
      {/* Password — re-keys the vault; your saved API keys carry over. */}
      <div className="mt-3" data-testid="vps-password-section">
        <div className="flex items-center gap-1.5 text-10 font-mono uppercase tracking-wider text-ink-mute mb-2">
          <KeyRound className="w-3 h-3" />
          Password
        </div>
        <p className="text-10 text-[#788fa8] leading-relaxed mb-2">
          Changing it re-keys the vault — your saved API keys carry over.
        </p>
        <div className="space-y-1.5">
          <input
            type="password"
            data-testid="vps-password-current"
            placeholder="Current password"
            autoComplete="current-password"
            value={vpsPwCurrent}
            onChange={(e) => setVpsPwCurrent(e.target.value)}
            className="w-full rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well"
          />
          <div className="flex gap-1.5">
            <input
              type="password"
              data-testid="vps-password-new"
              placeholder="New password (8+)"
              autoComplete="new-password"
              value={vpsPwNew}
              onChange={(e) => setVpsPwNew(e.target.value)}
              className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well"
            />
            <input
              type="password"
              data-testid="vps-password-confirm"
              placeholder="Repeat new"
              autoComplete="new-password"
              value={vpsPwConfirm}
              onChange={(e) => setVpsPwConfirm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && vpsPwCurrent && vpsPwNew && vpsPwConfirm) {
                  e.preventDefault();
                  void handleVpsPasswordChange();
                }
              }}
              className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well"
            />
          </div>
          <button
            onClick={() => void handleVpsPasswordChange()}
            data-testid="vps-password-save"
            className="px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-11 font-mono cursor-pointer"
          >
            Change password
          </button>
        </div>
        {vpsPwMsg && (
          <p className={`text-10 mt-2 ${vpsPwOk ? 'text-emerald-300' : 'text-red-400'}`}>{vpsPwMsg}</p>
        )}
      </div>

      {/* User management — owner only. */}
      <div className="mt-4 text-10 font-mono uppercase tracking-wider text-ink-mute mb-2">
        Users
      </div>
      {isOwner && (
      <>
      <div className="flex items-center gap-2 mb-3">
        <input
          type="email"
          placeholder="Email"
          value={newUserEmail}
          onChange={(e) => setNewUserEmail(e.target.value)}
          className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well"
        />
        <input
          type="password"
          placeholder="Initial password"
          autoComplete="new-password"
          value={newUserPassword}
          onChange={(e) => setNewUserPassword(e.target.value)}
          className="flex-1 rounded-lg bg-surface-3 text-ink font-mono text-11 px-2 py-1.5 shadow-well"
        />
        <button
          onClick={handleAddUser}
          data-testid="admin-add-user-submit"
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand/90 hover:bg-brand text-white text-11 font-mono cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          Add User
        </button>
      </div>

      {usersError && <p className="text-10 text-red-400 mb-2">{usersError}</p>}

      <div className="space-y-1.5">
        {users === null && <p className="text-11 text-ink-mute">Loading users…</p>}
        {users?.map((u) => (
          <div
            key={u.id}
            data-testid={`admin-user-row-${u.id}`}
            className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5"
          >
            <span className="flex-1 text-11 font-mono text-ink truncate">{u.email}</span>
            {u.isOwner && (
              <span className="flex items-center gap-1 text-9 font-mono uppercase px-1.5 py-0.5 rounded bg-veil-3 text-[#e0b96c]">
                <Shield className="w-3 h-3" />
                Owner
              </span>
            )}
            <span
              className={`text-9 font-mono uppercase px-1.5 py-0.5 rounded ${
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
                  className="px-2 py-0.5 rounded bg-veil-2 hover:bg-veil-3 text-10 font-mono text-ink cursor-pointer"
                >
                  {u.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => {
                    setResetPwFor(resetPwFor === u.id ? null : u.id);
                    setResetPwValue('');
                  }}
                  data-testid={`admin-reset-open-${u.id}`}
                  className="px-2 py-0.5 rounded bg-veil-2 hover:bg-veil-3 text-10 font-mono text-[#8ab1e0] cursor-pointer"
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
                  className="flex-1 rounded bg-surface-3 text-ink font-mono text-10 px-2 py-1 shadow-well"
                />
                <button
                  onClick={() => void handleResetPassword(u)}
                  data-testid={`admin-reset-submit-${u.id}`}
                  className="px-2 py-1 rounded bg-brand/90 text-white text-10 font-mono cursor-pointer"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      </>
      )}

    </section>
  );
};

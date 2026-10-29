/**
 * User management & the immutable Owner Account #1 (design-docs/21B §4).
 *
 * Hard Laws:
 * - Account #1 (`id = 1`) is the owner and can NEVER be disabled —
 *   `setUserEnabled(1, false)` throws, and the admin route mirrors it with 400.
 * - Disabling a user cuts every active session immediately (sessions deleted,
 *   vault key dropped from RAM).
 * - The first user created on a fresh install is forced to owner.
 * - Password changes preserve saved API keys when the vault can be decrypted
 *   at that moment (RAM-unlocked, or the old password is supplied).
 */
import crypto from 'node:crypto';
import { getDb } from '../db';
import {
  hashPassword,
  verifyPassword,
  deriveVaultKey,
  lockVault,
  hasSecretsRow,
  readKeysPayload,
  reencryptKeysPayload,
} from './accountVault';

export interface UserRecord {
  id: number;
  email: string;
  isOwner: boolean;
  enabled: boolean;
  createdAt: number;
}

interface RawUser {
  id: number;
  email: string;
  password_hash: string;
  kdf_salt: Buffer;
  is_owner: number;
  enabled: number;
  created_at: number;
}

function toRecord(row: RawUser): UserRecord {
  return {
    id: row.id,
    email: row.email,
    isOwner: row.is_owner === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

const SELECT_USER = 'SELECT id, email, password_hash, kdf_salt, is_owner, enabled, created_at FROM users';

export function countUsers(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n;
}

export function findUserByEmail(email: string): UserRecord | null {
  const row = getDb()
    .prepare(`${SELECT_USER} WHERE email = ? COLLATE NOCASE`)
    .get(email.trim().toLowerCase()) as RawUser | undefined;
  return row ? toRecord(row) : null;
}

export function findUserById(id: number): UserRecord | null {
  const row = getDb().prepare(`${SELECT_USER} WHERE id = ?`).get(id) as RawUser | undefined;
  return row ? toRecord(row) : null;
}

export function listUsers(): UserRecord[] {
  const rows = getDb().prepare(`${SELECT_USER} ORDER BY id`).all() as RawUser[];
  return rows.map(toRecord);
}

/** Raw row for credential verification (password_hash/kdf_salt stay in this module + accountVault). */
export function getRawUserByEmail(email: string): RawUser | null {
  const row = getDb()
    .prepare(`${SELECT_USER} WHERE email = ? COLLATE NOCASE`)
    .get(email.trim().toLowerCase()) as RawUser | undefined;
  return row ?? null;
}

export function getRawUserById(id: number): RawUser | null {
  const row = getDb().prepare(`${SELECT_USER} WHERE id = ?`).get(id) as RawUser | undefined;
  return row ?? null;
}

/**
 * Called on server boot: if the users table is empty AND both owner env vars
 * are set, create Account #1 (id=1, is_owner=1).
 */
export function ensureOwnerBootstrap(): UserRecord | null {
  // POLICY (David, 2026-10-26): there is NO signup, self-registration or
  // account-creation path for external users — not in the UI, not via the API.
  // AuthGate.tsx only ever signs in; POST /api/admin/users is owner-only
  // provisioning (requireOwner). DO NOT add a signup route or form.
  // Accounts exist only because: (a) this bootstrap seeds the owner account #1
  // from MARKBRAIN_OWNER_EMAIL / MARKBRAIN_OWNER_PASSWORD on an empty DB, or
  // (b) the owner explicitly creates them via /api/admin/users.
  if (countUsers() > 0) return null;
  const email = process.env.MARKBRAIN_OWNER_EMAIL;
  const password = process.env.MARKBRAIN_OWNER_PASSWORD;
  if (!email || !password) return null;
  return createUser(email, password, { isOwner: true });
}

export function createUser(email: string, password: string, opts: { isOwner?: boolean } = {}): UserRecord {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) throw new Error(`Invalid email address: ${email}`);
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (findUserByEmail(normalized)) throw new Error(`User already exists: ${normalized}`);

  const { stored, salt } = hashPassword(password);
  const forceOwner = countUsers() === 0; // first user on a fresh install is always the owner
  const isOwner = forceOwner || opts.isOwner === true;

  const info = getDb()
    .prepare(
      'INSERT INTO users (email, password_hash, kdf_salt, is_owner, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    )
    .run(normalized, stored, salt, isOwner ? 1 : 0, Date.now());

  const created = findUserById(Number(info.lastInsertRowid));
  if (!created) throw new Error('User creation failed.');
  return created;
}

/**
 * Create a user from a PRE-COMPUTED password hash (scrypt$<saltHex>$<hashHex>,
 * the exact format hashPassword stores) — used by the deployment flow so the
 * plaintext password never has to cross a command line. The server generates
 * its own fresh kdf_salt; the vault starts empty, and at login the vault key
 * derives from the password the user types. Knowing this hash does NOT allow
 * login — it is only an offline dictionary target.
 */
export function createUserWithHash(
  email: string,
  storedHash: string,
  opts: { isOwner?: boolean } = {}
): UserRecord {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) throw new Error(`Invalid email address: ${email}`);
  if (!/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(storedHash.trim())) {
    throw new Error('Invalid password hash format — expected scrypt$<saltHex32>$<hashHex128>.');
  }
  if (findUserByEmail(normalized)) throw new Error(`User already exists: ${normalized}`);

  const kdfSalt = crypto.randomBytes(16);
  const forceOwner = countUsers() === 0;
  const isOwner = forceOwner || opts.isOwner === true;

  const info = getDb()
    .prepare(
      'INSERT INTO users (email, password_hash, kdf_salt, is_owner, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)'
    )
    .run(normalized, storedHash.trim(), kdfSalt, isOwner ? 1 : 0, Date.now());

  const created = findUserById(Number(info.lastInsertRowid));
  if (!created) throw new Error('User creation failed.');
  return created;
}

/** Verify credentials for login. Returns the user or null (never throws on bad password). */
export function verifyCredentials(email: string, password: string): UserRecord | null {
  const row = getRawUserByEmail(email);
  if (!row || row.enabled !== 1) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return toRecord(row);
}

/**
 * Enable/disable a user.
 * Hard Law: the owner account (id=1 / is_owner) can never be disabled.
 * Disabling also deletes all sessions and drops the RAM vault key.
 */
export function setUserEnabled(targetUserId: number, enabled: boolean): void {
  const target = findUserById(targetUserId);
  if (!target) throw new Error(`User not found: ${targetUserId}`);
  if ((target.id === 1 || target.isOwner) && !enabled) {
    throw new Error('The owner account cannot be disabled.');
  }
  getDb().prepare('UPDATE users SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, targetUserId);
  if (!enabled) {
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
    lockVault(targetUserId); // cut off immediately
  }
}

/**
 * Change a password. Saved API keys survive when the vault is readable at
 * this moment (unlocked in RAM, or `oldPassword` decrypts `user_secrets`):
 * the payload is re-encrypted under the new kdf_salt + password.
 */
export function changeUserPassword(userId: number, newPassword: string, oldPassword?: string): boolean {
  if (newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
  const row = getRawUserById(userId);
  if (!row) throw new Error(`User not found: ${userId}`);
  const hadSecrets = hasSecretsRow(userId);

  const newSalt = crypto.randomBytes(16);
  const newVaultKey = deriveVaultKey(newPassword, newSalt);

  // Try to carry existing keys across the rotation.
  let payload: Record<string, string> | null = null;
  if (hasSecretsRow(userId)) {
    try {
      payload = readKeysPayload(userId) as Record<string, string> | null; // vault already unlocked
    } catch {
      if (oldPassword) {
        const oldVaultKey = deriveVaultKey(oldPassword, Buffer.from(row.kdf_salt));
        const sec = getDb()
          .prepare('SELECT iv, auth_tag, ciphertext FROM user_secrets WHERE user_id = ?')
          .get(userId) as { iv: Buffer; auth_tag: Buffer; ciphertext: Buffer } | undefined;
        if (sec) {
          try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', oldVaultKey, sec.iv);
            decipher.setAuthTag(sec.auth_tag);
            const plaintext = Buffer.concat([decipher.update(sec.ciphertext), decipher.final()]);
            payload = JSON.parse(plaintext.toString('utf8')) as Record<string, string>;
          } catch {
            payload = null; // wrong old password or corrupt row — keys are dropped, not guessed
          }
        }
      }
    }
  }

  const { stored } = hashPassword(newPassword, newSalt);
  getDb()
    .prepare('UPDATE users SET password_hash = ?, kdf_salt = ? WHERE id = ?')
    .run(stored, newSalt, userId);

  if (payload) {
    reencryptKeysPayload(userId, newVaultKey, payload);
    lockVault(userId); // RAM key was derived from the old salt — caller must re-unlock
  } else {
    lockVault(userId);
  }
  // No secrets row = nothing to lose. A row we could not decrypt = the keys are
  // orphaned under the old salt — the caller must tell the user, not hide it.
  return !hadSecrets || payload !== null;
}

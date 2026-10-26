/**
 * Auth, Owner admin & account key-vault routes (design-docs/21B §6).
 *
 * Public:  POST /api/auth/login
 * Auth:    POST /api/auth/logout, GET /api/auth/session, POST /api/auth/unlock,
 *          GET/PUT /api/account/settings, PUT /api/account/keys
 * Owner:   GET/POST /api/admin/users, PATCH /api/admin/users/:id
 *
 * Sessions: 32-byte random hex token, TTL 30 days, stored ONLY as sha256 in
 * `sessions.token_hash`; the raw token travels in `Authorization: Bearer` or
 * the `mb_session` HttpOnly; SameSite=Strict cookie.
 * Raw API keys never leave the server (redacted `{configured, hint}` only).
 */
import crypto from 'node:crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { getDb } from '../db';
import {
  isVaultUnlocked,
  lockVault,
  reArmKeyFor,
  reArmVaultWithKey,
  unlockVaultWithPassword,
  readKeysPayload,
  writeKeysPayload,
  redactKeys,
  KEY_SLOTS,
  VaultLockedError,
  type AccountKeysPayload,
  type KeySlotId,
  type AuthUser,
} from '../lib/accountVault';
import { hashPassword } from '../lib/accountVault';
import {
  findUserById,
  findUserByEmail,
  createUser,
  listUsers,
  setUserEnabled,
  changeUserPassword,
  getRawUserById,
} from '../lib/users';
import { verifyPassword } from '../lib/accountVault';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Fixed-window login rate limit (audit 26 H1): the public login runs
 * scryptSync (~50-100ms) per attempt, so unlimited guessing is both a
 * brute-force and a CPU-starvation vector. 10 failures per IP per 5 minutes;
 * successes don't count. In-memory: a restart clears it, which is fine for
 * this threat model (a patient attacker doesn't win by waiting for a restart,
 * the window re-arms).
 */
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const loginFailures = new Map<string, { count: number; windowStart: number }>();

function loginRateLimited(req: Request): boolean {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 0, windowStart: now });
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(req: Request): void {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}

function clearLoginFailures(req: Request): void {
  loginFailures.delete(req.ip ?? 'unknown');
}

/** Test hook: the limiter is module state; tests reset it between cases. */
export function resetLoginRateLimiterForTests(): void {
  loginFailures.clear();
}

/**
 * A hash of a value no real user has (audit 26 M8): verifying against it on
 * the unknown-email path costs the same scrypt run as a real attempt, so
 * response timing no longer reveals whether the email exists.
 */
const DUMMY_PASSWORD_HASH = hashPassword('timing-equalizer-' + '0'.repeat(24)).stored;

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookies = parseCookies(req);
  return cookies.mb_session ?? null;
}

/** 401 unless a live session for an enabled user attaches `req.user`. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const row = getDb()
    .prepare(
      `SELECT s.token_hash, s.user_id, s.expires_at, u.email, u.is_owner, u.enabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(sha256hex(token)) as
    | { token_hash: string; user_id: number; expires_at: number; email: string; is_owner: number; enabled: number }
    | undefined;

  if (!row || row.enabled !== 1 || row.expires_at <= Date.now()) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const user: AuthUser = {
    id: row.user_id,
    email: row.email,
    isOwner: row.is_owner === 1,
    vaultUnlocked: isVaultUnlocked(row.user_id),
  };
  req.user = user;
  next();
}

/** requireAuth + owner check (403 for authenticated non-owners). */
export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }
    if (!req.user?.isOwner) {
      res.status(403).json({ error: 'Owner access required.' });
      return;
    }
    next();
  });
}

function issueSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  // Expired rows would otherwise accumulate forever (audit 26 L5).
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  getDb()
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256hex(token), userId, now, now + SESSION_TTL_MS);
  return token;
}

function setSessionCookie(res: Response, token: string): void {
  // In production the app is always behind a TLS-terminating proxy, so the
  // cookie is always Secure there (audit 26 M2); req.secure alone is false
  // behind TLS termination without trust proxy.
  const secure = res.req.secure || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `mb_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

interface SettingsRow {
  model_slots_json: string;
  chat_tier: string;
}

export function readSettings(userId: number): { modelSlots: Record<string, string>; chatTier: string } {
  const row = getDb()
    .prepare('SELECT model_slots_json, chat_tier FROM user_settings WHERE user_id = ?')
    .get(userId) as SettingsRow | undefined;
  let modelSlots: Record<string, string> = {};
  if (row) {
    try {
      modelSlots = JSON.parse(row.model_slots_json) as Record<string, string>;
    } catch {
      modelSlots = {};
    }
  }
  return { modelSlots, chatTier: row?.chat_tier ?? 'free' };
}

// Four slots (design-docs/24 §1) — mirrors KEY_SLOTS from the vault module.
const VALID_SLOTS: KeySlotId[] = [...KEY_SLOTS];

export function registerAccountRoutes(app: Express): void {
  // ── POST /api/auth/login (public) ────────────────────────────────────────
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'email and password are required.' });
      return;
    }
    if (loginRateLimited(req)) {
      res.status(429).json({ error: 'Too many failed logins. Try again in a few minutes.' });
      return;
    }
    if (typeof req.headers['content-length'] === 'string' && Number(req.headers['content-length']) > 65536) {
      res.status(413).json({ error: 'Login body too large.' });
      return;
    }
    const user = findUserByEmail(email);
    const raw = user ? getRawUserById(user.id) : null;
    if (!user || !raw || raw.enabled !== 1 || !verifyPassword(password, raw.password_hash)) {
      // Unknown email / bad password: burn the same scrypt cost either way so
      // response timing does not reveal whether the account exists (26 M8).
      if (!raw) verifyPassword(password, DUMMY_PASSWORD_HASH);
      recordLoginFailure(req);
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    clearLoginFailures(req);
    try {
      unlockVaultWithPassword(user.id, password);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid email or password.' });
      return;
    }
    const token = issueSession(user.id);
    setSessionCookie(res, token);
    res.json({
      token,
      user: { id: user.id, email: user.email, isOwner: user.isOwner, vaultUnlocked: true },
      rearmKey: reArmKeyFor(user.id),
    });
  });

  // ── POST /api/auth/logout (requireAuth) ──────────────────────────────────
  app.post('/api/auth/logout', requireAuth, (req: Request, res: Response) => {
    const token = extractToken(req);
    if (token) {
      getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256hex(token));
    }
    const userId = req.user!.id;
    const remaining = getDb()
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
      .get(userId) as { n: number };
    if (remaining.n === 0) lockVault(userId); // last session out wipes the RAM key
    res.setHeader('Set-Cookie', 'mb_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  // ── GET /api/auth/session (requireAuth) ──────────────────────────────────
  app.get('/api/auth/session', requireAuth, (req: Request, res: Response) => {
    res.json({ user: req.user });
  });

  // ── POST /api/auth/unlock (requireAuth) ──────────────────────────────────
  app.post('/api/auth/unlock', requireAuth, (req: Request, res: Response) => {
    const { password } = req.body ?? {};
    if (typeof password !== 'string' || password.length === 0) {
      res.status(400).json({ error: 'password is required.' });
      return;
    }
    try {
      unlockVaultWithPassword(req.user!.id, password);
      // design 25: the derived key rides the response so THIS tab can re-arm
      // after a server restart without the password (TLS transit; tab RAM only).
      res.json({ ok: true, vaultUnlocked: true, rearmKey: reArmKeyFor(req.user!.id) });
    } catch {
      res.status(401).json({ error: 'Invalid password.' });
    }
  });

  // ── POST /api/auth/unlock-key (requireAuth; design 25 §2) ────────────────
  // Silent re-arm after a server restart: the tab proves knowledge of the
  // derived vault key against the DB verifier. Dead after a manual lock.
  app.post('/api/auth/unlock-key', requireAuth, (req: Request, res: Response) => {
    const { rearmKey } = req.body ?? {};
    if (typeof rearmKey !== 'string') {
      res.status(400).json({ error: 'rearmKey is required.' });
      return;
    }
    if (reArmVaultWithKey(req.user!.id, rearmKey)) {
      res.json({ ok: true, vaultUnlocked: true });
    } else {
      res.status(401).json({ error: 'Re-arm key rejected — unlock with your password.' });
    }
  });

  // ── GET /api/account/settings (requireAuth) ──────────────────────────────
  app.get('/api/account/settings', requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { modelSlots, chatTier } = readSettings(userId);
    let keys = redactKeys(null);
    let vaultUnlocked = isVaultUnlocked(userId);
    if (vaultUnlocked) {
      try {
        keys = redactKeys(readKeysPayload(userId));
      } catch (err) {
        if (err instanceof VaultLockedError) {
          vaultUnlocked = false;
        } else {
          throw err;
        }
      }
    }
    res.json({ modelSlots, chatTier, vaultUnlocked, keys });
  });

  // ── PUT /api/account/settings (requireAuth) ──────────────────────────────
  app.put('/api/account/settings', requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { modelSlots, chatTier } = req.body ?? {};
    const current = readSettings(userId);
    const nextSlots =
      modelSlots && typeof modelSlots === 'object' ? (modelSlots as Record<string, string>) : current.modelSlots;
    const nextTier = typeof chatTier === 'string' && chatTier === 'paid' ? 'paid' : chatTier === 'free' ? 'free' : current.chatTier;
    getDb()
      .prepare(
        `INSERT INTO user_settings (user_id, model_slots_json, chat_tier, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET model_slots_json = excluded.model_slots_json,
           chat_tier = excluded.chat_tier, updated_at = excluded.updated_at`
      )
      .run(userId, JSON.stringify(nextSlots), nextTier, Date.now());
    res.json({ ok: true, modelSlots: nextSlots, chatTier: nextTier });
  });

  // ── PUT /api/account/keys (requireAuth; vault must be unlocked, else 428) ─
  app.put('/api/account/keys', requireAuth, (req: Request, res: Response) => {
    const userId = req.user!.id;
    const { slot, apiKey } = req.body ?? {};
    if (!VALID_SLOTS.includes(slot)) {
      res.status(400).json({ error: `slot must be one of ${VALID_SLOTS.join(', ')}` });
      return;
    }
    if (apiKey !== null && typeof apiKey !== 'string') {
      res.status(400).json({ error: 'apiKey must be a string or null' });
      return;
    }
    if (!isVaultUnlocked(userId)) {
      const err = new VaultLockedError();
      res.status(428).json({ error: err.message, code: err.code });
      return;
    }
    let payload: AccountKeysPayload = {};
    try {
      payload = readKeysPayload(userId) ?? {};
    } catch (err) {
      if (err instanceof VaultLockedError) {
        res.status(428).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
    if (apiKey === null || apiKey === '') {
      delete payload[slot as KeySlotId];
    } else {
      payload[slot as KeySlotId] = apiKey;
    }
    writeKeysPayload(userId, payload);
    res.json({ ok: true, keys: redactKeys(payload) });
  });

  // ── Owner admin (requireAuth + requireOwner) ─────────────────────────────
  app.get('/api/admin/users', requireOwner, (_req: Request, res: Response) => {
    res.json({ users: listUsers() });
  });

  app.post('/api/admin/users', requireOwner, (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'email and password are required.' });
      return;
    }
    try {
      const created = createUser(email, password);
      res.status(201).json({ user: created });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'User creation failed.' });
    }
  });

  app.patch('/api/admin/users/:id', requireOwner, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid user id.' });
      return;
    }
    const target = findUserById(id);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const { enabled, password } = req.body ?? {};

    if (enabled === false && (target.id === 1 || target.isOwner)) {
      res.status(400).json({ error: 'The owner account cannot be disabled.' });
      return;
    }
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean.' });
      return;
    }
    if (password !== undefined && (typeof password !== 'string' || password.length < 8)) {
      res.status(400).json({ error: 'password must be at least 8 characters.' });
      return;
    }

    try {
      if (typeof enabled === 'boolean') setUserEnabled(id, enabled);
      if (typeof password === 'string') changeUserPassword(id, password);
      res.json({ user: findUserById(id) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Update failed.' });
    }
  });
}

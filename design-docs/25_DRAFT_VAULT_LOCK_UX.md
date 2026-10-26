# 25 — Vault Lock UX: proactive padlock + auto re-arm (DRAFT, 2026-10-26)

Status: approved by David 2026-10-26 ("all looks good — do both together").

## Problem
After a VPS server restart the account vault locks (RAM key wiped, design 21B
§3). The user discovers this by typing a message and hitting send → 428
VAULT_LOCKED failure. Reactive, confusing. Local mode has its own vault lock
(browser-side) with the same discover-by-failure UX.

## Design

### 1. Proactive lock state (both modes)
- One lock signal: `src/application/vaultLockBus.ts` — `isVaultLocked()`,
  `setVaultLocked(bool)`, `subscribe(cb)`.
- VPS: refreshed by piggybacking a `GET /api/auth/session` onto the existing
  10s delta poll (no new poller, no new endpoint).
- Local: computed from `localKeyVault` state at render + explicit updates on
  unlock/lock actions.
- UI: when locked, the send button renders as a padlock (amber). Clicking it —
  or pressing send while locked — opens an inline password row above the
  composer (reuses the same unlock flow as the draft-card row). On success the
  padlock clears and the send proceeds normally.

### 2. Auto re-arm (VPS only)
Law kept: an explicit user lock must WIN over auto re-unlock.

- At `POST /api/auth/unlock` the server ALSO returns `{ rearmKey }` — the
  derived 32-byte vault key, hex. TLS-protected transit, same trust level as
  the password POST that already happens. The client holds it in **tab RAM
  only** (`src/data/vaultReArm.ts`) — never localStorage, never IndexedDB.
- The server stores `users.vault_rearm_hash = SHA-256(rearmKey)` (a verifier,
  not the key; brute-force through it is the same attack surface the stored
  password hash already offers — none new).
- New route `POST /api/auth/unlock-key { rearmKey }` (requireAuth): hash
  matches → vault armed, no password. One call per occurrence, never polled.
- `lockVault(userId, { manual })`: a manual lock (logout of the last session,
  admin disable, password change) CLEARS `vault_rearm_hash` → re-arm becomes
  impossible. A restart touches only RAM → hash survives → the tab silently
  re-arms on the next locked send.
- Send path: when a draft fails with VAULT_LOCKED and a rearm key is held, the
  client attempts `unlock-key` once per draft and retries the send
  automatically. The user should never see the failure for a restart-lock; the
  padlock still shows the state for awareness.

### Rejected alternatives
- Holding the **password** in the browser: weaker than holding the derived key
  (password reuse across sites) — rejected.
- Client-side scrypt from an exposed `kdf_salt`: no benefit over the server
  returning the derived key at unlock time (the key ends up in tab RAM either
  way) — more code, new dependency, rejected.
- Epoch counter for lock generations: unnecessary once manual locks clear the
  rearm hash — the absence of a verifier IS the epoch.

### Security deltas, stated plainly
- An XSS in the tab holding a rearm key can re-arm the vault. A live session
  token already grants full proxy access while unlocked, so the marginal
  exposure is the locked window only. Accepted deliberately.
- The rearm key dies with the tab: refresh → password unlock again. Comfort
  within a session, not a credential store.
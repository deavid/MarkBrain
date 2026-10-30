/**
 * accountVault — pure barrel (Phase 6 split).
 *
 * The 385-line four-tenant module is now two real modules, each with one job:
 * - vaultCrypto.ts — it encrypts, decrypts, hashes, and verifies secrets
 *   (password hashing, the AES-256-GCM user_secrets store, the RAM key vault
 *   + lock/unlock/re-arm state, redaction).
 * - laneKeys.ts — it decides which key signs each AI request and builds the
 *   clients (resolveServerLaneKey, the per-request AI client builders, the
 *   error → HTTP vocabulary).
 *
 * Importers keep importing from here unchanged.
 */
export * from './vaultCrypto';
export * from './laneKeys';
export type { LaneAiSurface } from '../providers/lane';

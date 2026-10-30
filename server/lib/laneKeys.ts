/**
 * laneKeys — it decides which key signs each AI request and builds the clients.
 *
 * Split out of accountVault.ts (Phase 6): the per-lane/tier key-slot
 * resolution (resolveServerLaneKey), the per-request AI client builders
 * (aiForRequest / embedClientForRequest / aiClientForUser / geminiAiForRequest),
 * and the error → HTTP vocabulary (sendVaultError). The secret side (hashing,
 * the AES-256-GCM store, the RAM vault + lock/re-arm state) lives in
 * vaultCrypto.ts; accountVault.ts re-exports both.
 */
import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { OpenRouterClient, isOpenRouterModel } from '../providers/openrouter';
import { getDb } from '../db';
import { isVaultUnlocked, VaultLockedError, readKeysPayload, type AccountKeysPayload } from './vaultCrypto';

export type LaneCapability = 'chat' | 'extract' | 'summarize' | 'qaGen' | 'title' | 'embed' | 'tts';

export class NoKeyError extends Error {
  readonly status = 400;
  readonly code = 'NO_API_KEY';
  constructor(provider: string) {
    super(`No API key configured for ${provider}. Open Model Settings → Keys to add one.`);
  }
}

/** Map a thrown crypto/vault error onto the HTTP vocabulary. */
export function sendVaultError(res: Response, err: unknown): void {
  if (err instanceof VaultLockedError) {
    res.status(428).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof NoKeyError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  const msg = err instanceof Error ? err.message : 'Internal error';
  res.status(500).json({ error: msg });
}

// ── Lane key resolution (§3.4) ──────────────────────────────────────────────

export function resolveServerLaneKey(userId: number, capability: LaneCapability, modelId: string): string {
  const payload: AccountKeysPayload = readKeysPayload(userId) ?? {};
  const tierRow = getDb()
    .prepare('SELECT chat_tier FROM user_settings WHERE user_id = ?')
    .get(userId) as { chat_tier: string } | undefined;
  const chatTier = tierRow?.chat_tier ?? 'free';

  // OpenRouter models carry a provider prefix (`vendor/model`). The same tier
  // law as Gemini (design-docs/24 §2): PAID tier prefers the paid key on every
  // lane, FREE tier prefers the free key — each falling back to the other, then
  // to the legacy pre-split `openrouter` slot.
  if (isOpenRouterModel(modelId)) {
    const orFree = payload['openrouter-free'];
    const orPaid = payload['openrouter-paid'];
    const legacy = payload.openrouter;
    if (chatTier === 'paid') {
      if (orPaid) return orPaid;
      if (orFree) return orFree;
      if (legacy) return legacy;
    } else {
      if (orFree) return orFree;
      if (orPaid) return orPaid;
      if (legacy) return legacy;
    }
    throw new NoKeyError('openrouter');
  }

  // Tier is ACCOUNT-WIDE (David 2026-10-25): "PAID" means every Gemini lane —
  // chat, extract, summarize, title, qaGen, embed, tts — signs with the paid
  // key. The earlier chat-only reading made embeddings/title/extract burn the
  // free quota while chat alone ran paid. Free tier prefers the free key with
  // paid as fallback (free = generous quota; paid = costs money per call).
  // Explicit OpenRouter routing above is unaffected. Design-docs/21B §3.4
  // amended accordingly.
  if (chatTier === 'paid' && payload['gemini-paid']) return payload['gemini-paid'];
  if (payload['gemini-free']) return payload['gemini-free'];
  if (payload['gemini-paid']) return payload['gemini-paid'];
  throw new NoKeyError('gemini');
}

// ── Per-request AI client (§7.3) ────────────────────────────────────────────

/** Either provider, behind the identical call surface (design-docs/24 §4). */
export type LaneAiClient = GoogleGenAI | OpenRouterClient;

function clientForApiKey(modelId: string, apiKey: string): LaneAiClient {
  return isOpenRouterModel(modelId) ? new OpenRouterClient(apiKey) : new GoogleGenAI({ apiKey });
}

/**
 * Build the caller's AI client for this request: requires an authenticated
 * user (requireAuth), an unlocked vault (else 428), and a configured lane key
 * (else 400 NO_API_KEY). Never reads process.env.
 *
 * Facade (design-docs/24 §4): a `/`-shaped model id returns the OpenRouter
 * client; everything else stays GoogleGenAI. Both expose
 * models.generateContent / models.generateContentStream yielding `{text}`.
 */
export function aiForRequest(req: Request, capability: LaneCapability, modelId: string): LaneAiClient {
  const user = req.user;
  if (!user) throw new VaultLockedError(); // requireAuth should have caught this; fail closed
  if (!isVaultUnlocked(user.id)) throw new VaultLockedError();
  const apiKey = resolveServerLaneKey(user.id, capability, modelId);
  return clientForApiKey(modelId, apiKey);
}

/**
 * Embed-capable client for either provider (design 24 facade extended to
 * embeddings): `/`-shaped ids get the OpenRouter client (its models surface
 * includes embedContent), everything else GoogleGenAI. Requires an unlocked
 * vault and a configured lane key — same fail-closed law as aiForRequest.
 */
export function embedClientForRequest(req: Request, modelId: string): LaneAiClient {
  const user = req.user;
  if (!user) throw new VaultLockedError();
  if (!isVaultUnlocked(user.id)) throw new VaultLockedError();
  const apiKey = resolveServerLaneKey(user.id, 'embed', modelId);
  return clientForApiKey(modelId, apiKey);
}

/** Same law, keyed by userId — the job runner has no Request (21E: decoupled). */
export function aiClientForUser(userId: number, capability: LaneCapability, modelId: string): LaneAiClient {
  if (!isVaultUnlocked(userId)) throw new VaultLockedError();
  const apiKey = resolveServerLaneKey(userId, capability, modelId);
  return clientForApiKey(modelId, apiKey);
}

/**
 * Gemini-only lanes (embed, tts): the raw GoogleGenAI client. The catalog
 * caps those lanes to Gemini model ids, so an OpenRouter id here is a hard
 * error, never a silent swap (errors are final).
 */
export function geminiAiForRequest(req: Request, capability: LaneCapability, modelId: string): GoogleGenAI {
  if (isOpenRouterModel(modelId)) {
    throw new Error(`Model "${modelId}" is not available for ${capability} on this server.`);
  }
  const user = req.user;
  if (!user) throw new VaultLockedError();
  if (!isVaultUnlocked(user.id)) throw new VaultLockedError();
  const apiKey = resolveServerLaneKey(user.id, capability, modelId);
  return new GoogleGenAI({ apiKey });
}

/**
 * Per-user settings storage — the user_settings table (model slots + chat tier).
 *
 * It reads and writes the per-user settings row. Lived inline in
 * routes/account.ts until jobs/serverArtifactIndexer needed a read and could
 * only get it through a lazy require that dodged a circular import — routes
 * must not be a library. Now both the route and the job runner import from
 * here, and the lazy require is dead.
 */
import { getDb } from '../db';

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

/** The write half of the same storage — the PUT /api/account/settings handler delegates here. */
export function writeSettings(userId: number, modelSlots: Record<string, string>, chatTier: string): void {
  getDb()
    .prepare(
      `INSERT INTO user_settings (user_id, model_slots_json, chat_tier, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET model_slots_json = excluded.model_slots_json,
         chat_tier = excluded.chat_tier, updated_at = excluded.updated_at`
    )
    .run(userId, JSON.stringify(modelSlots), chatTier, Date.now());
}

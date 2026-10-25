/**
 * usePairingTransfer — send a project backup to another device (§5).
 *
 * Send: export → encryptBundle (pairing code) → PUT /api/mailbox/:slot →
 * show the pairing URL (the code rides in the FRAGMENT). The server stores
 * only ciphertext; anyone who reads the mailbox learns nothing.
 *
 * Pickup: if the page was opened with `#pair=…`, fetch the one-shot bundle,
 * decrypt with that code, import, and CLEAR the fragment so the secret does
 * not linger in history or get re-sent on reload.
 */
import { useCallback, useState } from 'react';
import { exportDatabase, parseDatabaseExport, importDatabase } from '../../services/persistenceService';
import {
  createPairingCode,
  encryptBundle,
  decryptBundle,
  pairingUrl,
  type EncryptedBundle,
} from '../../gateway/pairing';
import { logger } from '../../utils/logger';

export interface PairingSendState {
  status: 'idle' | 'sending' | 'ready' | 'error';
  /** The URL to show/QR-encode. Secret is in the fragment. */
  url?: string;
  error?: string;
}

function randomSlotId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 22);
}

export function usePairingTransfer() {
  const [sendState, setSendState] = useState<PairingSendState>({ status: 'idle' });

  const sendToPhone = useCallback(async () => {
    setSendState({ status: 'sending' });
    try {
      const data = await exportDatabase();
      const { code } = createPairingCode();
      const bundle = await encryptBundle(code, data);
      const slot = randomSlotId();
      const res = await fetch(`/api/mailbox/${slot}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `mailbox rejected the bundle (HTTP ${res.status})`);
      }
      // The code+slot travel together in the fragment; the server never sees either.
      const url = pairingUrl(`${code}.${slot}`, window.location.origin + window.location.pathname);
      setSendState({ status: 'ready', url });
      logger.info('Pairing', `Bundle queued for pickup (TTL 10 min)`);
      return url;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'pairing send failed';
      setSendState({ status: 'error', error: message });
      logger.error('Pairing', message, err);
      return null;
    }
  }, []);

  const clearSend = useCallback(() => setSendState({ status: 'idle' }), []);

  /**
   * Run at boot: if the URL carries #pair=code.slot, pick the bundle up.
   * Returns the number of imported projects, or null when there was no
   * pairing to do / it failed (the UI shows the error either way).
   */
  const pickupIfPaired = useCallback(async (): Promise<number | null> => {
    // Fragment is `#pair=<code>.<slot>` — parse directly (the pairing.ts
    // helper stops at `.` on purpose: it only ever returns the secret).
    const m = /#pair=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(window.location.hash || '');
    if (!m) return null;
    const [, code, slot] = m;

    try {
      const res = await fetch(`/api/mailbox/${slot}`);
      if (!res.ok) {
        logger.warn('Pairing', 'No bundle waiting (expired, used, or never existed)');
        window.location.hash = '';
        return null;
      }
      const bundle = (await res.json()) as EncryptedBundle;
      const data = await decryptBundle<Parameters<typeof parseDatabaseExport>[0]>(code, bundle);
      if (!data) {
        logger.error('Pairing', 'Bundle could not be decrypted — wrong code?');
        window.location.hash = '';
        return null;
      }
      const parsed = parseDatabaseExport(JSON.stringify(data));
      const n = await importDatabase(parsed);
      // The secret dies here: clear the fragment before anything else can see it.
      window.location.hash = '';
      logger.info('Pairing', `Picked up ${n} project(s) from the paired device`);
      return n;
    } catch (err: unknown) {
      logger.error('Pairing', `Pickup failed: ${err instanceof Error ? err.message : err}`, err);
      window.location.hash = '';
      return null;
    }
  }, []);

  return { sendState, sendToPhone, clearSend, pickupIfPaired };
}

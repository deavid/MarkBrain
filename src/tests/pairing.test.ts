/**
 * QR pairing + E2E bundle encryption (design-docs/16 §5, D4/D6).
 * Pins: the server only ever sees ciphertext, the QR carries a secret in a
 * URL fragment (never a query string), and a wrong code cannot decrypt.
 */
import { describe, it, expect } from 'vitest';
import {
  createPairingCode,
  pairingUrl,
  parsePairingUrl,
  encryptBundle,
  decryptBundle,
} from '../gateway/pairing';

describe('pairing codes', () => {
  it('generates 128-bit URL-safe codes, unique per call', () => {
    const a = createPairingCode().code;
    const b = createPairingCode().code;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(20); // 16 bytes → 22 chars b64url
  });

  it('the QR payload carries the secret in the FRAGMENT, never the query', () => {
    const { code } = createPairingCode();
    const url = pairingUrl(code, 'https://markbrain.example/app');
    expect(url).toContain('#pair=');
    expect(url).not.toContain('?pair=');
    // The fragment is what the browser strips from requests — by construction.
    expect(parsePairingUrl(url)).toBe(code);
  });

  it('parsePairingUrl survives copy-paste noise and rejects junk', () => {
    const { code } = createPairingCode();
    expect(parsePairingUrl(`https://x.test/#pair=${code}&other=1`)).toBe(code);
    expect(parsePairingUrl('https://x.test/')).toBeNull();
    expect(parsePairingUrl('')).toBeNull();
  });
});

describe('bundle encryption', () => {
  it('round-trips a project-sized payload', async () => {
    const { code } = createPairingCode();
    const bundle = {
      format: 'markbrain-database',
      version: 1,
      projects: [{ projectId: 'p1', artifacts: [{ id: 'a1', body: 'x'.repeat(50_000) }] }],
    };
    const enc = await encryptBundle(code, bundle);
    const dec = await decryptBundle<typeof bundle>(code, enc);
    expect(dec).toEqual(bundle);
  });

  it('ciphertext never contains plaintext (D4: server cannot read it)', async () => {
    const { code } = createPairingCode();
    const marker = 'TOP-SECRET-BIRD-FACT-9271';
    const enc = await encryptBundle(code, { secret: marker });
    expect(enc.ciphertextB64).not.toContain(marker);
    expect(atob(enc.ciphertextB64)).not.toContain(marker);
    // the code itself is not derivable from the ciphertext fields either
    expect(enc.ivB64).not.toContain(code);
    expect(enc.saltB64).not.toContain(code);
  });

  it('wrong code decrypts to null — genuinely undecryptable', async () => {
    const { code } = createPairingCode();
    const enc = await encryptBundle(code, { hello: 'world' });
    const dec = await decryptBundle('not-the-right-code-at-all', enc);
    expect(dec).toBeNull();
  });

  it('tampered ciphertext fails to null (AES-GCM auth tag)', async () => {
    const { code } = createPairingCode();
    const enc = await encryptBundle(code, { hello: 'world' });
    const bytes = Uint8Array.from(atob(enc.ciphertextB64), (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    const tampered = {
      ...enc,
      ciphertextB64: btoa(String.fromCharCode(...bytes)),
    };
    expect(await decryptBundle(code, tampered)).toBeNull();
  });

  it('malformed bundles return null, never throw', async () => {
    const { code } = createPairingCode();
    expect(
      await decryptBundle(code, { ivB64: 'zz', ciphertextB64: 'zz', saltB64: 'zz' })
    ).toBeNull();
  });

  it('refuses to encrypt under a stub code (too short to be a real secret)', async () => {
    await expect(encryptBundle('abc', {})).rejects.toThrow(/too short/);
  });
});

/**
 * pairing — QR pairing + E2E bundle encryption (design-docs/16 §5, D4/D6).
 *
 * The QR carries a ONE-TIME SECRET, never data (a QR holds ~3 KiB; a project
 * is megabytes). The secret goes in a URL FRAGMENT (`#pair=…`) so it never
 * reaches any server's logs. The export bundle is encrypted client-side with
 * AES-GCM under a key derived from that secret via HKDF — the VPS mailbox
 * holds opaque bytes for minutes and CANNOT decrypt them even if it wanted
 * to (D4: "impossible for me to decode on the fly").
 *
 * Threat model: the server is an untrusted-but-available bucket. Anyone who
 * reads the mailbox blob learns nothing without the QR. Pairing codes are
 * single-use and expire; a replay at best re-delivers ciphertext.
 *
 * WebCrypto only — no hand-rolled crypto.
 */

export interface PairingSecret {
  /** URL-safe secret shown in the QR fragment. 128+ bits of entropy. */
  code: string;
}

export interface EncryptedBundle {
  /** AES-GCM iv (base64) — not secret. */
  ivB64: string;
  /** AES-GCM ciphertext of the UTF-8 bundle JSON (base64). */
  ciphertextB64: string;
  /** HKDF salt (base64) — not secret. */
  saltB64: string;
}

const CODE_BYTES = 16; // 128 bits
const BUNDLE_TTL_MS = 10 * 60 * 1000; // mailbox keeps ciphertext this long (§5)

function subtle(): SubtleCrypto | null {
  try {
    return typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null;
  } catch {
    return null;
  }
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** URL-safe base64 (no +/= — survives QR alphanumeric mode and copy-paste). */
function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(text: string): Uint8Array {
  const norm = text.replace(/-/g, '+').replace(/_/g, '/');
  return b64decode(norm + '='.repeat((4 - (norm.length % 4)) % 4));
}

/** Fresh one-time pairing secret (128 bits). */
export function createPairingCode(): PairingSecret {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_BYTES));
  return { code: b64url(bytes) };
}

/**
 * The QR payload: a URL whose FRAGMENT carries the secret. Fragments are
 * never sent to any server (browser strips them from requests) — that is
 * why the secret lives there and not in a query string (§4.4).
 */
export function pairingUrl(code: string, baseUrl: string): string {
  return `${baseUrl.replace(/#.*$/, '')}#pair=${encodeURIComponent(code)}`;
}

/** Pull the secret back out of a scanned/copied pairing URL. */
export function parsePairingUrl(url: string): string | null {
  const m = /#pair=([A-Za-z0-9_-]+)/.exec(url ?? '');
  return m ? m[1] : null;
}

async function deriveBundleKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtleApi = subtle();
  if (!subtleApi) throw new Error('WebCrypto unavailable — cannot encrypt the bundle');
  const material = await subtleApi.importKey(
    'raw',
    new TextEncoder().encode(code),
    'HKDF',
    false,
    ['deriveKey']
  );
  return subtleApi.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as unknown as BufferSource,
      info: new TextEncoder().encode('markbrain-pairing-bundle-v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a bundle (any JSON-serializable payload — a DatabaseExport, for
 * instance) under the pairing code. The SERVER only ever sees the returned
 * bytes; the code never leaves the QR.
 */
export async function encryptBundle(code: string, bundle: unknown): Promise<EncryptedBundle> {
  const subtleApi = subtle();
  if (!subtleApi) throw new Error('WebCrypto unavailable — cannot encrypt the bundle');
  const pass = (code ?? '').trim();
  if (pass.length < 8) throw new Error('Pairing code too short');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveBundleKey(pass, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(bundle ?? {}));
  const ciphertext = await subtleApi.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    bytes
  );
  return {
    ivB64: b64encode(iv),
    ciphertextB64: b64encode(ciphertext),
    saltB64: b64encode(salt),
  };
}

/**
 * Decrypt on the receiving device. Wrong code → null (genuinely
 * undecryptable). Malformed input → null. Never throws for bad data.
 */
export async function decryptBundle<T = unknown>(code: string, bundle: EncryptedBundle): Promise<T | null> {
  const subtleApi = subtle();
  if (!subtleApi) return null;
  try {
    const pass = (code ?? '').trim();
    const salt = b64decode(bundle.saltB64);
    const key = await deriveBundleKey(pass, salt);
    const plainBuf = await subtleApi.decrypt(
      { name: 'AES-GCM', iv: b64decode(bundle.ivB64) as unknown as BufferSource },
      key,
      b64decode(bundle.ciphertextB64) as unknown as BufferSource
    );
    return JSON.parse(new TextDecoder().decode(plainBuf)) as T;
  } catch {
    return null;
  }
}

/** How long the mailbox may keep ciphertext (server enforces its own cap too). */
export const BUNDLE_TTL_MS_VALUE = BUNDLE_TTL_MS;

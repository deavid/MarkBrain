/**
 * Content-Security-Policy for the shell (design-docs/16 §4.2 Tier 2.3).
 *
 * Defense-in-depth behind the markdown escape-first contract (§4.3): even if
 * something slips past the renderer, `script-src` without 'unsafe-inline'
 * turns most XSS into a key-*use* incident instead of key *exfiltration* —
 * the payload cannot simply POST the user's localStorage keys to an attacker.
 *
 * Every origin listed is one the app actually calls. If a feature gains a new
 * external origin, add it HERE and say why — do not widen the defaults.
 * Firebase/Google auth/Picker origins removed (design-docs/19, Phase 1).
 *
 * Dev difference: Vite's dev server + React Fast Refresh inject inline
 * scripts and open an HMR websocket, so dev relaxes script-src and allows
 * ws:. Production is strict. The relaxation is dev-only and deliberate.
 */

export function cspHeader(isDev: boolean): string {
  // Firebase / Google auth / Picker origins are gone (design-docs/19):
  // only the two model providers remain as third-party origins.
  const scriptSrc = isDev ? `'self' 'unsafe-inline' 'unsafe-eval'` : `'self'`;
  const connectExtras = isDev ? ' ws:' : '';

  return [
    `default-src 'self'`,
    // Prod: only our bundles. Dev: vite/react-refresh inline scripts.
    `script-src ${scriptSrc}`,
    // 'unsafe-inline' for styles: React style props write inline style
    // attributes (progress bars, geometry in the graph lens).
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    // Markdown may embed https: images; TTS/audio and object URLs use data:/blob:.
    `img-src 'self' data: blob: https:`,
    `media-src 'self' data: blob:`,
    // Direct provider calls (BYOK) — nothing else. Markdown never emits
    // iframes (raw HTML unsupported), so frame-src stays 'self'.
    `connect-src 'self' https://generativelanguage.googleapis.com https://openrouter.ai${connectExtras}`,
    `frame-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

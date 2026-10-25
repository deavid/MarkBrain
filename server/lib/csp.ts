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
 *
 * Dev difference: Vite's dev server + React Fast Refresh inject inline
 * scripts and open an HMR websocket, so dev relaxes script-src and allows
 * ws:. Production is strict. The relaxation is dev-only and deliberate.
 */

export function cspHeader(isDev: boolean): string {
  const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
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
    // Direct provider calls (BYOK) + Firebase + Drive import, nothing else.
    `connect-src 'self' https://generativelanguage.googleapis.com https://openrouter.ai https://*.googleapis.com https://*.google.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.googleapis.com wss://*.firebaseio.com${connectExtras}`,
    // Google auth popups/redirect frames + the Drive Picker iframe.
    `frame-src 'self' https://accounts.google.com https://apis.google.com https://docs.google.com https://*.google.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

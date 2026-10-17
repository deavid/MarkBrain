// Error-code → UI-class mapping for the auth gate.
// Driven by error CODES, never message strings: firebase.ts preserves `code`
// on every path it throws, so AuthGate can pick honest actions per class.

export type AuthErrorClass = 'domain' | 'key' | 'transient' | 'unknown';

export function classifyAuthError(code?: string | null): AuthErrorClass {
  if (!code) return 'unknown';

  // Origin isn't allowlisted — only fix is a console change; retry is pointless.
  if (code === 'auth/unauthorized-domain') return 'domain';

  // The web API key itself is bad — fix lives in .env + dev-server restart.
  if (code.startsWith('auth/invalid-api-key') || code.startsWith('auth/api-key-expired')) {
    return 'key';
  }

  // Human-scale hiccups: retry is honest here.
  const transient = [
    'auth/popup-blocked',
    'auth/popup-closed-by-user',
    'auth/cancelled-popup-request',
    'auth/network-request-failed',
  ];
  if (transient.some((t) => code === t || code.startsWith(t))) return 'transient';

  return 'unknown';
}
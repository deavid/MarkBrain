import React, { useState } from 'react';
import { Brain, AlertCircle, Terminal, HardDrive, RefreshCw, ChevronDown, Server } from 'lucide-react';
import { logger } from '../../utils/logger';
import type { KnownReplica } from '../../services/workspaceSession';

interface AuthGateProps {
  /** VPS login: POST /api/auth/login against baseUrl ('' = same origin). */
  onVpsLogin: (email: string, password: string, baseUrl: string) => Promise<unknown>;
  onContinueLocal: () => Promise<void> | void;
  /** Open a known replica from its local mirror — offline, no login call. */
  onOpenOfflineReplica?: (replica: KnownReplica) => Promise<void> | void;
  /** Replicas with a local mirror on this device (from the session machine). */
  knownReplicas?: KnownReplica[];
  onOpenServerLogs?: () => void;
}

/**
 * Pre-flight gate (design-docs/21C §3) — two crystal-clear entry paths:
 * 1. Primary: Sign in to Server (email + password, optional Server URL).
 * 2. Secondary: Use Local Workspace (this browser only, BYOK).
 */
export const AuthGate: React.FC<AuthGateProps> = ({
  onVpsLogin,
  onContinueLocal,
  onOpenOfflineReplica,
  knownReplicas = [],
  onOpenServerLogs,
}) => {
  // "Remember email on this device": a tick the user gives, not a leak the
  // gate prints — the replica card no longer shows anyone's address.
  const REMEMBERED_EMAIL_KEY = 'markbrain.remembered-email';
  const remembered = (() => {
    try {
      return localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? '';
    } catch {
      return '';
    }
  })();
  const [email, setEmail] = useState(remembered);
  const [rememberEmail, setRememberEmail] = useState(() => remembered !== '');
  const [chooserOpen, setChooserOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const effectiveBaseUrl = showUrl ? serverUrl.trim().replace(/\/+$/, '') : '';

  const openOffline = (replica: KnownReplica) => {
    if (!onOpenOfflineReplica) return;
    let host = replica.baseUrl;
    try {
      host = new URL(replica.baseUrl || window.location.origin).host;
    } catch {
      /* keep raw string */
    }
    logger.action('AuthGate', `Open offline replica: ${replica.email} @ ${host}`);
    setErrorMessage(null);
    void onOpenOfflineReplica(replica);
  };

  // Which copies live on THIS origin, and which one did the user name? The
  // email field (typed or remembered) is what makes "the offline copy"
  // mean something when several accounts share this device.
  const offlineOrigin = (() => {
    try {
      return new URL(effectiveBaseUrl || window.location.origin).origin;
    } catch {
      return window.location.origin;
    }
  })();
  const originReplicas = knownReplicas.filter((r) => {
    try {
      return new URL(r.baseUrl || window.location.origin).origin === offlineOrigin;
    } catch {
      return false;
    }
  });
  const namedEmail = email.trim().toLowerCase();
  const namedReplica = namedEmail
    ? originReplicas.find((r) => r.email.toLowerCase() === namedEmail) ?? null
    : null;

  const handleVpsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage('Email and password are required.');
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      logger.action('AuthGate', 'Sign in to Server submitted');
      await onVpsLogin(email.trim(), password, effectiveBaseUrl);
      try {
        if (rememberEmail) localStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
        else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      } catch {
        /* storage unavailable — the tick just won't persist */
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed.';
      setErrorMessage(msg);
      logger.error('AuthGate', 'Server sign-in failed', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleContinueLocal = () => {
    logger.action('AuthGate', 'User chose Local Workspace');
    setErrorMessage(null);
    void onContinueLocal();
  };

  return (
    <div className="flex items-center justify-center min-h-screen w-screen bg-surface-0 text-ink p-5 select-none relative overflow-hidden font-sans">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 w-[560px] h-[560px] -translate-x-1/2 -translate-y-[64%] rounded-full bg-[radial-gradient(circle,rgba(224,90,102,0.12),transparent_62%)]"
      />

      <div className="relative z-10 w-full max-w-[360px] flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-surface-2 flex items-center justify-center shadow-step">
            <Brain className="w-7 h-7 text-brand" />
          </div>
          <h1 className="text-26 leading-none font-semibold tracking-tight text-ink">
            MarkBrain
          </h1>
          <p className="text-13 leading-relaxed text-ink-dim max-w-[280px]">
            A thinking workbench for overflowing brains.
          </p>
        </div>

        {/* 1. Primary — Sign in to Server */}
        <form
          onSubmit={handleVpsLogin}
          data-testid="vps-login-form"
          className="w-full flex flex-col gap-3 rounded-2xl bg-surface-2 shadow-step p-4"
        >
          <div className="flex items-center gap-2 text-11 font-semibold uppercase tracking-wider text-ink-dim">
            <Server className="w-3.5 h-3.5 text-brand" />
            Sign in to Server
          </div>

          <input
            type="email"
            data-testid="vps-login-email"
            autoComplete="username"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-10 rounded-xl bg-surface-0 border border-line px-3 text-13 text-ink placeholder:text-ink-mute focus:outline-none focus:border-brand"
          />
          <input
            type="password"
            data-testid="vps-login-password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-10 rounded-xl bg-surface-0 border border-line px-3 text-13 text-ink placeholder:text-ink-mute focus:outline-none focus:border-brand"
          />

          <label
            data-testid="remember-email"
            className="flex items-center gap-2 text-11 text-ink-dim cursor-pointer select-none"
          >
            <input
              type="checkbox"
              checked={rememberEmail}
              onChange={(e) => setRememberEmail(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer"
            />
            Remember email on this device
          </label>

          <button
            type="button"
            data-testid="vps-login-url-toggle"
            onClick={() => setShowUrl((v) => !v)}
            className="flex items-center gap-1 text-10 font-mono text-ink-mute hover:text-ink-dim transition-colors cursor-pointer self-start"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showUrl ? 'rotate-180' : ''}`} />
            Server URL
          </button>
          {showUrl && (
            <input
              type="url"
              data-testid="vps-login-url"
              placeholder={typeof window !== 'undefined' ? window.location.origin : ''}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full h-9 rounded-xl bg-surface-0 border border-line px-3 text-11 font-mono text-ink placeholder:text-ink-mute focus:outline-none focus:border-brand"
            />
          )}

          <button
            type="submit"
            data-testid="vps-login-submit"
            disabled={isLoading}
            className="w-full h-10 rounded-xl bg-brand hover:bg-brand/90 text-white text-13 font-semibold shadow-step transition-colors cursor-pointer disabled:opacity-60"
          >
            {isLoading ? 'Signing in…' : 'Sign In'}
          </button>

          {/* Offline entry — tied to the account in the email field. Many
              accounts can keep copies on this device; the link names its
              account when the email field tells it which one, and only
              asks (inline, on click) when it genuinely cannot tell. */}
          {onOpenOfflineReplica && originReplicas.length > 0 && !isLoading && (
            namedReplica || originReplicas.length === 1 ? (
              <button
                type="button"
                data-testid="open-offline-replica"
                onClick={() => openOffline(namedReplica ?? originReplicas[0])}
                className="text-10 font-mono text-ink-mute hover:text-ink-dim underline underline-offset-2 transition-colors cursor-pointer self-center"
                title="Read-only copy of your workspace stored on this device"
              >
                {namedReplica
                  ? `Open offline copy for ${namedReplica.email}`
                  : 'Open offline copy'}
              </button>
            ) : chooserOpen ? (
              <div className="self-center flex flex-col items-center gap-1" data-testid="offline-chooser">
                {originReplicas.map((r) => {
                  let host = r.baseUrl;
                  try {
                    host = new URL(r.baseUrl || window.location.origin).host;
                  } catch {
                    /* keep raw string */
                  }
                  return (
                    <button
                      key={r.email}
                      type="button"
                      onClick={() => openOffline(r)}
                      className="text-10 font-mono text-ink-mute hover:text-ink underline underline-offset-2 transition-colors cursor-pointer"
                    >
                      Open {r.email} @ {host}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setChooserOpen(false)}
                  className="text-10 font-mono text-ink-mute/60 hover:text-ink-mute cursor-pointer"
                >
                  never mind
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setChooserOpen(true)}
                className="text-10 font-mono text-ink-mute hover:text-ink-dim underline underline-offset-2 transition-colors cursor-pointer self-center"
                title="Which account's copy?"
              >
                Open offline copy…
              </button>
            )
          )}
        </form>

        {/* 2. Secondary — Local Workspace */}
        <div className="w-full flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={handleContinueLocal}
            disabled={isLoading}
            data-testid="continue-local"
            className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl bg-surface-2 hover:bg-surface-3 active:bg-surface-4 text-ink text-13 font-medium shadow-step transition-colors cursor-pointer disabled:opacity-60"
          >
            <HardDrive className="w-4 h-4 text-ink-dim" />
            <span>Use Local Workspace</span>
          </button>
          <p className="text-11 leading-relaxed text-ink-mute text-center max-w-[300px]">
            Stays in this browser only. Bring your own API key.
          </p>
        </div>

        {errorMessage && (
          <div className="w-full p-3.5 rounded-xl bg-wash-danger space-y-2 text-xs text-red-300 animate-in fade-in duration-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold text-red-200 block">Sign-in failed</span>
                <p className="text-11 text-red-300/90 leading-normal">{errorMessage}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={handleVpsLogin}
                className="px-2.5 py-1 rounded-lg bg-veil-3 hover:bg-veil-4 text-red-200 text-11 font-mono transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 inline mr-1" />
                Try again
              </button>

              {onOpenServerLogs && (
                <button
                  type="button"
                  onClick={onOpenServerLogs}
                  className="px-2.5 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-11 font-mono text-[#8ab1e0] transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Terminal className="w-3 h-3 text-[#38bdf8]" />
                  <span>Inspect logs</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

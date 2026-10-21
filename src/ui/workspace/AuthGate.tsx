import React, { useState } from 'react';
import { Brain, LogIn, AlertCircle, RefreshCw, Terminal, CheckCircle2, ExternalLink, HardDrive } from 'lucide-react';
import { logger } from '../../utils/logger';
import { classifyAuthError } from '../../utils/authErrors';
import { isFirebaseConfigured } from '../../services/firebase';

interface AuthGateProps {
  onSignIn: () => Promise<any>;
  onContinueLocal?: () => Promise<void>;
  onOpenServerLogs?: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onSignIn, onContinueLocal, onOpenServerLogs }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const handleContinueLocal = () => {
    logger.action('AuthGate', 'User chose Continue locally (Local space)');
    onContinueLocal?.();
  };

  const handleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setErrorCode(null);
    logger.action('AuthGate', 'User clicked Continue with Google from pre-flight gate');

    try {
      await onSignIn();
      logger.info('AuthGate', 'Sign in resolved successfully');
    } catch (err: any) {
      const code = typeof err?.code === 'string' ? err.code : 'auth/unknown';
      setErrorCode(code);
      setErrorMessage(
        err?.message || 'Authentication failed. Check popups and network, then try again.'
      );
      logger.error('AuthGate', `Sign-in failed (${code})`, err);
    } finally {
      setIsLoading(false);
    }
  };

  const errorClass = classifyAuthError(errorCode);
  const projectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || '';
  const authDomainUrl = `https://console.firebase.google.com/project/${projectId}/authentication/settings`;
  const credentialsUrl = `https://console.cloud.google.com/apis/credentials?project=${projectId}`;

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
          <h1 className="text-[26px] leading-none font-semibold tracking-tight text-ink">
            MarkBrain
          </h1>
          <p className="text-[13px] leading-relaxed text-ink-dim max-w-[280px]">
            A thinking workbench for overflowing brains.
          </p>
        </div>

        <div className="w-full flex flex-col items-center gap-4">
          {isFirebaseConfigured ? (
            <button
              type="button"
              onClick={handleSignIn}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl bg-white text-[#1f1f1f] hover:bg-[#eef1f5] active:bg-[#e4e8ee] disabled:opacity-60 text-[13px] font-medium shadow-lg shadow-black/50 transition-colors cursor-pointer"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Connecting…</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 48 48" className="w-[18px] h-[18px] shrink-0" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                  <span>Continue with Google</span>
                </>
              )}
          </button>
          ) : (
            <button
              type="button"
              onClick={handleContinueLocal}
              className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl bg-surface-2 hover:bg-surface-3 active:bg-surface-4 text-ink text-[13px] font-medium shadow-step transition-colors cursor-pointer"
            >
              <HardDrive className="w-4 h-4 text-ink-dim" />
              <span>Continue locally</span>
            </button>
          )}

          {isFirebaseConfigured ? (
            onContinueLocal && (
              <button
                type="button"
                onClick={handleContinueLocal}
                disabled={isLoading}
                className="text-[12px] text-ink-dim hover:text-ink underline decoration-line hover:decoration-ink-mute underline-offset-4 disabled:opacity-50 transition-colors cursor-pointer"
              >
                Use local storage instead
              </button>
            )
          ) : (
            <p className="text-[11px] leading-relaxed text-ink-mute text-center max-w-[300px]">
              Google sign-in is disabled: <code className="font-mono">FIREBASE_API_KEY</code> is
              empty. Cloud projects and Drive import need it — everything you make here is saved to
              this browser's IndexedDB only.
            </p>
          )}
        </div>

        {/* Error Alert — actions chosen by error CLASS, not offered blindly */}
        {errorMessage && (
          <div className="w-full p-3.5 rounded-xl bg-wash-danger space-y-2 text-xs text-red-300 animate-in fade-in duration-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold text-red-200 block">Sign-In Interrupted</span>
                <p className="text-[11px] text-red-300/90 leading-normal">{errorMessage}</p>
                {errorCode && (
                  <p className="text-[10px] font-mono text-red-400/60">code: {errorCode}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              {(errorClass === 'transient' || errorClass === 'unknown') && (
                <button
                  type="button"
                  onClick={handleSignIn}
                  className="px-2.5 py-1 rounded-lg bg-veil-3 hover:bg-veil-4 text-red-200 text-[11px] font-mono transition-colors cursor-pointer"
                >
                  Try Again
                </button>
              )}

              {errorClass === 'domain' && (
                <a
                  href={authDomainUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[11px] font-mono text-[#38bdf8] transition-colors cursor-pointer flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open Authorized Domains</span>
                </a>
              )}

              {errorClass === 'key' && (
                <a
                  href={credentialsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[11px] font-mono text-[#38bdf8] transition-colors cursor-pointer flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open Cloud Credentials</span>
                </a>
              )}

              {onOpenServerLogs && (
                <button
                  type="button"
                  onClick={onOpenServerLogs}
                  className="px-2.5 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[11px] font-mono text-[#8ab1e0] transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Terminal className="w-3 h-3 text-[#38bdf8]" />
                  <span>Inspect Logs</span>
                </button>
              )}
            </div>

            {errorClass === 'domain' && (
              <p className="text-[10px] text-red-400/70 leading-relaxed">
                Fix: Firebase Console → Authentication → Settings → Authorized Domains → add{' '}
                <code className="text-red-300">{window.location.hostname}</code>. Retrying won&apos;t
                help until then.
              </p>
            )}
            {errorClass === 'key' && (
              <p className="text-[10px] text-red-400/70 leading-relaxed">
                Fix: update <code className="text-red-300">FIREBASE_API_KEY</code> in your local{' '}
                <code className="text-red-300">.env</code> and restart the dev server.
              </p>
            )}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-ink-mute text-center max-w-[300px]">
          Cloud sync, or stay in this browser only — either way you can export everything at any
          time.
        </p>
      </div>
    </div>
  );
};
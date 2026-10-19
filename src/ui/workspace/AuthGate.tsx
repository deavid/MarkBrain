import React, { useState } from 'react';
import { Brain, LogIn, AlertCircle, RefreshCw, Terminal, CheckCircle2, ExternalLink, HardDrive } from 'lucide-react';
import { logger } from '../../utils/logger';
import { classifyAuthError } from '../../utils/authErrors';

interface AuthGateProps {
  onSignIn: () => Promise<any>;
  onContinueLocal?: () => Promise<void>;
  onOpenServerLogs?: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onSignIn, onContinueLocal, onOpenServerLogs }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

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
    <div className="flex items-center justify-center min-h-screen w-screen bg-[#070b12] text-[#d6e3f5] p-4 select-none relative overflow-hidden font-sans">
      {/* Background ambient grid lines */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a15_1px,transparent_1px),linear-gradient(to_bottom,#0f172a15_1px,transparent_1px)] bg-[size:48px_48px] pointer-events-none" />

      {/* Main Authentication Card */}
      <div className="relative z-10 w-full max-w-md p-6 sm:p-8 bg-[#0b101a] border border-[#141f33] rounded-2xl shadow-2xl space-y-6">
        {/* Brand Header */}
        <div className="space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#121c2d] border border-[#1e2e47] flex items-center justify-center text-[#e05a66] shadow-sm">
            <Brain className="w-6 h-6 text-[#e05a66]" />
          </div>

          <div>
            <h1 className="text-xl font-bold tracking-tight text-white font-mono">
              MarkBrain
            </h1>
            <p className="text-xs text-[#6e85a6] mt-1 leading-relaxed">
              A thinking workbench for overflowing brains
            </p>
          </div>

          {/* Unboxed Metadata separator */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#4d6382] font-mono pt-1">
            <span>Cloud or local</span>
            <span aria-hidden="true">·</span>
            <span>exportable anytime</span>
          </div>
        </div>

        {/* Informative Explanation */}
        <div className="p-3.5 rounded-xl bg-[#080d16] border border-[#131d2e] space-y-2 text-xs text-[#8299ba] leading-relaxed">
          <p className="text-[#c5d7ed] font-medium">
            Where your data lives
          </p>
          <p className="text-[11px] text-[#6b82a3]">
            Sign in with Google for cloud storage, or continue locally — your data stays in this
            browser (IndexedDB), portable anytime via database backup/restore.
          </p>
        </div>

        {/* Error Alert — actions chosen by error CLASS, not offered blindly */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/30 space-y-2 text-xs text-red-300 animate-in fade-in duration-200">
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
                  className="px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-200 text-[11px] font-mono border border-red-700/40 transition-colors cursor-pointer"
                >
                  Try Again
                </button>
              )}

              {errorClass === 'domain' && (
                <a
                  href={authDomainUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 rounded-lg bg-[#0e1626] hover:bg-[#162238] text-[11px] font-mono text-[#38bdf8] border border-[#1c2e47] transition-colors cursor-pointer flex items-center gap-1"
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
                  className="px-2.5 py-1 rounded-lg bg-[#0e1626] hover:bg-[#162238] text-[11px] font-mono text-[#38bdf8] border border-[#1c2e47] transition-colors cursor-pointer flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open Cloud Credentials</span>
                </a>
              )}

              {onOpenServerLogs && (
                <button
                  type="button"
                  onClick={onOpenServerLogs}
                  className="px-2.5 py-1 rounded-lg bg-[#0e1626] hover:bg-[#162238] text-[11px] font-mono text-[#8ab1e0] border border-[#1c2e47] transition-colors cursor-pointer flex items-center gap-1"
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

        {/* Action Buttons: two branches — Google (cloud) / Local (IndexedDB) */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={handleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-[#1d3557] hover:bg-[#23426e] active:bg-[#192f4d] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold tracking-wide shadow-md transition-all cursor-pointer border border-[#2b5185]"
          >
            {isLoading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-[#38bdf8]" />
                <span>Connecting to Google Auth...</span>
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4 text-[#38bdf8]" />
                <span>Continue with Google</span>
              </>
            )}
          </button>

          {onContinueLocal && (
            <button
              type="button"
              onClick={() => {
                logger.action('AuthGate', 'User chose Continue locally (Local space)');
                onContinueLocal();
              }}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl bg-[#0e1626] hover:bg-[#162238] active:bg-[#0b1220] disabled:opacity-50 text-[#8ab1e0] text-xs font-medium tracking-wide transition-all cursor-pointer border border-[#1c2e47]"
            >
              <HardDrive className="w-4 h-4 text-[#5ad49b]" />
              <span>Continue locally</span>
            </button>
          )}
        </div>

        {/* Footer Security Guarantee */}
        <div className="pt-2 border-t border-[#121c2d] flex items-center justify-between text-[10px] font-mono text-[#4b607d]">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span>Stored per account</span>
          </div>
          <span>Export anytime</span>
        </div>
      </div>
    </div>
  );
};
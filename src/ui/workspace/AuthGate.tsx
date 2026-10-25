import React, { useState } from 'react';
import { Brain, AlertCircle, Terminal, HardDrive, RefreshCw } from 'lucide-react';
import { logger } from '../../utils/logger';

interface AuthGateProps {
  onSignIn: () => Promise<any>;
  onContinueLocal?: () => Promise<void>;
  onOpenServerLogs?: () => void;
}

/**
 * Pre-flight gate. Firebase sign-in is gone (design-docs/19): today the only
 * branch is Local Workspace (IndexedDB, this browser). Phase 21C adds the
 * "Sign in to Server" (VPS account) form above Continue locally.
 */
export const AuthGate: React.FC<AuthGateProps> = ({ onSignIn, onContinueLocal, onOpenServerLogs }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleContinueLocal = () => {
    logger.action('AuthGate', 'User chose Continue locally (Local workspace)');
    onContinueLocal?.();
  };

  const handleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await onSignIn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed.';
      setErrorMessage(msg);
      logger.error('AuthGate', 'Sign-in failed', err);
    } finally {
      setIsLoading(false);
    }
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
          <h1 className="text-[26px] leading-none font-semibold tracking-tight text-ink">
            MarkBrain
          </h1>
          <p className="text-[13px] leading-relaxed text-ink-dim max-w-[280px]">
            A thinking workbench for overflowing brains.
          </p>
        </div>

        <div className="w-full flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={handleContinueLocal}
            disabled={isLoading}
            data-testid="continue-local"
            className="w-full flex items-center justify-center gap-2.5 h-11 rounded-xl bg-surface-2 hover:bg-surface-3 active:bg-surface-4 text-ink text-[13px] font-medium shadow-step transition-colors cursor-pointer disabled:opacity-60"
          >
            <HardDrive className="w-4 h-4 text-ink-dim" />
            <span>Continue locally</span>
          </button>

          <p className="text-[11px] leading-relaxed text-ink-mute text-center max-w-[300px]">
            Stays in this browser only — saved to this device's IndexedDB. Bring your own API
            key to talk to the model. Export a backup at any time.
          </p>
        </div>

        {errorMessage && (
          <div className="w-full p-3.5 rounded-xl bg-wash-danger space-y-2 text-xs text-red-300 animate-in fade-in duration-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold text-red-200 block">Sign-in failed</span>
                <p className="text-[11px] text-red-300/90 leading-normal">{errorMessage}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={handleSignIn}
                className="px-2.5 py-1 rounded-lg bg-veil-3 hover:bg-veil-4 text-red-200 text-[11px] font-mono transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3 h-3 inline mr-1" />
                Try again
              </button>

              {onOpenServerLogs && (
                <button
                  type="button"
                  onClick={onOpenServerLogs}
                  className="px-2.5 py-1 rounded-lg bg-veil-2 hover:bg-veil-3 text-[11px] font-mono text-[#8ab1e0] transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Terminal className="w-3 h-3 text-[#38bdf8]" />
                  <span>Inspect logs</span>
                </button>
              )}
            </div>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-ink-mute text-center max-w-[300px]">
          Everything you make here is stored in this browser. Export a backup at any time.
        </p>
      </div>
    </div>
  );
};

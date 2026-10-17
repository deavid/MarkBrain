import React, { useState } from 'react';
import { Brain, LogIn, AlertCircle, RefreshCw, Terminal, CheckCircle2, Key, ExternalLink } from 'lucide-react';
import { logger } from '../utils/logger';
import { saveCustomApiKey } from '../services/firebase';

interface AuthGateProps {
  onSignIn: () => Promise<any>;
  onOpenServerLogs?: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ onSignIn, onOpenServerLogs }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [customKey, setCustomKey] = useState('');

  const handleSignIn = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    logger.action('AuthGate', 'User clicked Sign in with Google from pre-flight gate');

    try {
      await onSignIn();
      logger.info('AuthGate', 'Sign in resolved successfully');
    } catch (err: any) {
      const msg = err?.message || 'Authentication failed. Please check your connection and popup permissions.';
      logger.error('AuthGate', 'Google sign-in attempt failed', err);
      setErrorMessage(msg);
      if (
        msg.includes('api-key-expired') ||
        msg.includes('API key expired') ||
        msg.includes('invalid-api-key') ||
        msg.includes('API_KEY_INVALID')
      ) {
        setShowKeyInput(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customKey.trim()) return;
    logger.action('AuthGate', 'Saved updated Firebase Web API Key in browser localStorage');
    saveCustomApiKey(customKey.trim());
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-screen bg-[#070b12] text-[#d6e3f5] p-4 select-none relative overflow-hidden font-sans">
      {/* Background ambient architectural grid lines */}
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
              Optical Context Substrate & Dialogue Architecture
            </p>
          </div>

          {/* Unboxed Metadata separator */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#4d6382] font-mono pt-1">
            <span>Firestore Persistence</span>
            <span aria-hidden="true">·</span>
            <span>Zero-Leakage Memory</span>
            <span aria-hidden="true">·</span>
            <span>Cloud Isolated</span>
          </div>
        </div>

        {/* Informative Explanation */}
        <div className="p-3.5 rounded-xl bg-[#080d16] border border-[#131d2e] space-y-2 text-xs text-[#8299ba] leading-relaxed">
          <p className="text-[#c5d7ed] font-medium">
            Personal Database Access Gate
          </p>
          <p className="text-[11px] text-[#6b82a3]">
            To read your architectural chapters, topological graphs, and dialogue turns, sign in with your Google account. Your data is isolated strictly to your user profile.
          </p>
        </div>

        {/* Error Alert if sign-in fails */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-500/30 space-y-2 text-xs text-red-300 animate-in fade-in duration-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold text-red-200 block">Sign-In Interrupted</span>
                <p className="text-[11px] text-red-300/90 leading-normal">{errorMessage}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleSignIn}
                className="px-2.5 py-1 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-200 text-[11px] font-mono border border-red-700/40 transition-colors cursor-pointer"
              >
                Try Again
              </button>
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
              <button
                type="button"
                onClick={() => setShowKeyInput(true)}
                className="px-2.5 py-1 rounded-lg bg-[#0e1626] hover:bg-[#162238] text-[11px] font-mono text-[#38bdf8] border border-[#1c2e47] transition-colors cursor-pointer flex items-center gap-1"
              >
                <Key className="w-3 h-3" />
                <span>Enter New API Key</span>
              </button>
            </div>
          </div>
        )}

        {/* Web API Key Renewal Panel */}
        {showKeyInput && (
          <form onSubmit={handleSaveKey} className="p-3.5 rounded-xl bg-[#0e1626] border border-[#1e324d] space-y-2.5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#8ab1e0]">
                <Key className="w-3.5 h-3.5 text-[#38bdf8]" />
                <span>Renew Firebase Web API Key</span>
              </div>
              <a
                href="https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0408097994"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#38bdf8] hover:underline flex items-center gap-1"
              >
                <span>Google Cloud Credentials</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>

            <p className="text-[11px] text-[#7893b8] leading-relaxed">
              If the initial key was deleted, paste your new Web API Key for project <code className="text-[#38bdf8]">gen-lang-client-0408097994</code> below. Stored exclusively in your browser&apos;s LocalStorage and never committed to Git.
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder="AIzaSy..."
                className="flex-1 bg-[#070b12] border border-[#1e3047] rounded-lg px-2.5 py-1.5 text-xs font-mono text-white placeholder-[#475b75] focus:outline-none focus:border-[#38bdf8]"
                required
              />
              <button
                type="submit"
                disabled={!customKey.trim()}
                className="px-3 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 text-white text-xs font-mono font-medium transition-colors cursor-pointer shrink-0"
              >
                Save & Reload
              </button>
            </div>
          </form>
        )}

        {/* Action Button: Sign In with Google */}
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

          {!showKeyInput && (
            <div className="flex items-center justify-center pt-1">
              <button
                type="button"
                onClick={() => setShowKeyInput(true)}
                className="text-[10px] font-mono text-[#4b607d] hover:text-[#7893b8] transition-colors cursor-pointer flex items-center gap-1"
              >
                <Key className="w-3 h-3" />
                <span>Configure / Renew Firebase API Key</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer Security Guarantee */}
        <div className="pt-2 border-t border-[#121c2d] flex items-center justify-between text-[10px] font-mono text-[#4b607d]">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span>Encrypted per-user isolation</span>
          </div>
          <span>Firestore v2</span>
        </div>
      </div>
    </div>
  );
};

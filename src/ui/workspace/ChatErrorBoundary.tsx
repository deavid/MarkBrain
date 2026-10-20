import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '../../utils/logger';
import { AlertTriangle, RefreshCw, Terminal } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
  onOpenServerLogs?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ChatErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    logger.error('ErrorBoundary', `UI Rendering Error caught: ${error.message}`, {
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  handleReload = () => {
    logger.action('ErrorBoundary', 'User initiated error recovery reload');
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex-1 h-full flex items-center justify-center p-6 bg-surface-0 text-ink">
          <div className="max-w-lg w-full p-6 bg-surface-1 rounded-2xl shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <div className="p-2.5 rounded-xl bg-red-500/10">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold text-base text-ink">Chat View Encountered an Error</h3>
                <p className="text-xs text-[#8ab1e0] font-mono">Component lifecycle fault recovered</p>
              </div>
            </div>

            <div className="p-3 bg-surface-0 rounded-xl font-mono text-xs text-red-300 overflow-x-auto max-h-40">
              {this.state.error?.message || 'Unknown runtime error'}
            </div>

            <div className="flex items-center justify-between pt-2">
              {this.props.onOpenServerLogs && (
                <button
                  type="button"
                  onClick={this.props.onOpenServerLogs}
                  className="px-3 py-1.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-xs font-mono text-[#8ab1e0] transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-[#38bdf8]" />
                  <span>Inspect Logs</span>
                </button>
              )}

              <button
                type="button"
                onClick={this.handleReload}
                className="px-4 py-2 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-ink text-xs font-mono font-medium shadow-md transition-colors flex items-center gap-2 cursor-pointer ml-auto"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Recover & Reload Chat</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

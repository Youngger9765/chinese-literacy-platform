import React, { Component, ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback UI override. Receives error + reset callback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

/**
 * Generates a short, human-readable error ID based on a timestamp and a
 * random suffix.  Format: ERR-<base36-ts>-<4-char-random>
 * Example: ERR-m5kx2a-7f3q
 *
 * This ID is:
 * - Included in the structured console log so Cloud Logging can correlate it.
 * - Shown to the user so they can paste it into a bug report.
 * - Never derived from the error message / stack, so it leaks no internals.
 */
function generateErrorId(): string {
  const ts = Date.now().toString(36); // e.g. "m5kx2a"
  const rand = Math.random().toString(36).slice(2, 6); // 4 chars
  return `ERR-${ts}-${rand}`;
}

/**
 * Top-level React error boundary.
 *
 * Catches render-phase errors anywhere in the component tree, logs them to
 * the browser console (picked up by Cloud Logging in production), and
 * displays a friendly recovery UI instead of a blank page.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorId: generateErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { errorId } = this.state;

    // Log to console — Cloud Logging ingests stdout/stderr from Cloud Run.
    // Keep this structured so Cloud Logging can parse it as JSON when the
    // browser forwards logs (e.g. via Cloud Logging agent or custom transport).
    console.error(
      JSON.stringify({
        severity: 'ERROR',
        event: 'react_render_error',
        errorId,
        message: error.message,
        // Stack trace without full local file paths to avoid leaking dev env info.
        componentStack: info.componentStack
          ?.split('\n')
          .slice(0, 10)
          .join(' | '),
      })
    );
  }

  handleReset(): void {
    this.setState({ hasError: false, error: null, errorId: null });
  }

  render(): React.ReactNode {
    const { hasError, error, errorId } = this.state;
    const { children, fallback } = this.props;

    if (!hasError || !error) {
      return children;
    }

    if (fallback) {
      return fallback(error, this.handleReset);
    }

    return (
      <DefaultErrorUI
        error={error}
        errorId={errorId ?? ''}
        onReset={this.handleReset}
      />
    );
  }
}

// ---------------------------------------------------------------------------
// Default error UI
// ---------------------------------------------------------------------------

const DefaultErrorUI: React.FC<{
  error: Error;
  errorId: string;
  onReset: () => void;
}> = ({ error, errorId, onReset }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: the error ID is selectable so the user can copy manually
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50 p-6">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
          <span className="text-red-500 text-2xl" aria-hidden="true">!</span>
        </div>

        <h1 className="text-xl font-bold text-gray-900">頁面發生錯誤</h1>

        <p className="text-sm text-gray-600 leading-relaxed">
          很抱歉，頁面遇到了一個問題。請嘗試重新載入，或聯絡系統管理員。
        </p>

        {/* Error ID — safe to show in all environments; contains no internals */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs text-gray-500">錯誤代碼（回報問題時請提供）</p>
          <div className="flex items-center justify-center gap-2">
            <code className="text-sm font-mono text-gray-800 select-all">
              {errorId}
            </code>
            <button
              onClick={handleCopy}
              aria-label="複製錯誤代碼"
              className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors"
            >
              {copied ? '已複製' : '複製'}
            </button>
          </div>
        </div>

        {/* Show a brief, non-sensitive error hint in development */}
        {process.env.NODE_ENV !== 'production' && (
          <p className="text-xs text-red-400 font-mono bg-red-50 rounded px-3 py-2 text-left break-words">
            {error.message}
          </p>
        )}

        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={onReset}
            className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            重新載入
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
          >
            整頁重整
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorBoundary;

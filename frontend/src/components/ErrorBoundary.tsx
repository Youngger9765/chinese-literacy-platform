import React, { Component, ErrorInfo } from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional fallback UI override. Receives error + reset callback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
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
    this.state = { hasError: false, error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console — Cloud Logging ingests stdout/stderr from Cloud Run.
    // Keep this structured so Cloud Logging can parse it as JSON when the
    // browser forwards logs (e.g. via Cloud Logging agent or custom transport).
    console.error(
      JSON.stringify({
        severity: 'ERROR',
        event: 'react_render_error',
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
    this.setState({ hasError: false, error: null });
  }

  render(): React.ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (!hasError || !error) {
      return children;
    }

    if (fallback) {
      return fallback(error, this.handleReset);
    }

    return <DefaultErrorUI error={error} onReset={this.handleReset} />;
  }
}

// ---------------------------------------------------------------------------
// Default error UI
// ---------------------------------------------------------------------------

const DefaultErrorUI: React.FC<{ error: Error; onReset: () => void }> = ({
  error,
  onReset,
}) => (
  <div className="min-h-screen flex items-center justify-center bg-amber-50 p-6">
    <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
      <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto">
        <span className="text-red-500 text-2xl" aria-hidden="true">!</span>
      </div>

      <h1 className="text-xl font-bold text-gray-900">頁面發生錯誤</h1>

      <p className="text-sm text-gray-600 leading-relaxed">
        很抱歉，頁面遇到了一個問題。請嘗試重新載入，或聯絡系統管理員。
      </p>

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

export default ErrorBoundary;

/**
 * StepErrorBoundary — lightweight error boundary for individual learning steps.
 *
 * Unlike the top-level ErrorBoundary (which auto-reloads the whole page),
 * this boundary is scoped to a single step so a failure in one step
 * (e.g. an AI call timeout in ComprehensionChat or LiveTutor) does NOT
 * crash the entire learning session.
 *
 * Features:
 * - Shows a friendly Chinese error message with the step name
 * - "重試" button resets the boundary and re-mounts the step
 * - Logs a structured error record to the console (Cloud Logging picks it up)
 * - Accepts an optional `onSkip` callback so callers can wire in
 *   a "跳過此步驟" action without coupling the boundary to router logic
 *
 * Usage:
 *   <StepErrorBoundary stepLabel="逐段朗讀" onSkip={() => navigate('/learn/x/full-reading')}>
 *     <TutorPage />
 *   </StepErrorBoundary>
 */
import React, { Component, ErrorInfo } from 'react';

// ---------------------------------------------------------------------------
// Error ID helper (copied from ErrorBoundary.tsx — kept local to avoid coupling)
// ---------------------------------------------------------------------------

function generateErrorId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `ERR-${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// Props / State
// ---------------------------------------------------------------------------

export interface StepErrorBoundaryProps {
  /** Human-readable step name shown in the error UI (e.g. "逐段朗讀"). */
  stepLabel: string;
  children: React.ReactNode;
  /**
   * Optional callback wired to the "跳過此步驟" button.
   * When omitted the skip button is not rendered.
   */
  onSkip?: () => void;
}

interface StepErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

// ---------------------------------------------------------------------------
// Class component (error boundaries must be class components in React)
// ---------------------------------------------------------------------------

class StepErrorBoundary extends Component<StepErrorBoundaryProps, StepErrorBoundaryState> {
  constructor(props: StepErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorId: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: Error): StepErrorBoundaryState {
    return { hasError: true, error, errorId: generateErrorId() };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const { errorId } = this.state;
    const { stepLabel } = this.props;

    // Structured log — Cloud Logging ingests stdout/stderr from Cloud Run.
    console.error(
      JSON.stringify({
        severity: 'ERROR',
        event: 'learning_step_render_error',
        errorId,
        stepLabel,
        message: error.message,
        componentStack: info.componentStack
          ?.split('\n')
          .slice(0, 10)
          .join(' | '),
      }),
    );
  }

  handleReset(): void {
    this.setState({ hasError: false, error: null, errorId: null });
  }

  render(): React.ReactNode {
    const { hasError, error, errorId } = this.state;
    const { children, stepLabel, onSkip } = this.props;

    if (!hasError || !error) {
      return children;
    }

    return (
      <StepErrorUI
        stepLabel={stepLabel}
        errorId={errorId ?? ''}
        error={error}
        onReset={this.handleReset}
        onSkip={onSkip}
      />
    );
  }
}

// ---------------------------------------------------------------------------
// Fallback UI
// ---------------------------------------------------------------------------

const StepErrorUI: React.FC<{
  stepLabel: string;
  errorId: string;
  error: Error;
  onReset: () => void;
  onSkip?: () => void;
}> = ({ stepLabel, errorId, error, onReset, onSkip }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — errorId is selectable so user can copy manually
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center space-y-4">
        {/* Icon */}
        <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto">
          <span className="text-orange-500 text-xl" aria-hidden="true">!</span>
        </div>

        {/* Title */}
        <h2 className="text-lg font-bold text-gray-900">
          「{stepLabel}」載入時發生錯誤
        </h2>

        {/* Description */}
        <p className="text-sm text-gray-600 leading-relaxed">
          這個學習步驟暫時無法使用。你可以重試，或跳過此步驟繼續學習。
        </p>

        {/* Error ID */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 space-y-1">
          <p className="text-xs text-gray-500">錯誤代碼（回報問題時請提供）</p>
          <div className="flex items-center justify-center gap-2">
            <code className="text-xs font-mono text-gray-700 select-all">{errorId}</code>
            <button
              onClick={handleCopy}
              aria-label="複製錯誤代碼"
              className="text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors"
            >
              {copied ? '已複製' : '複製'}
            </button>
          </div>
        </div>

        {/* Dev-only error hint */}
        {process.env.NODE_ENV !== 'production' && (
          <p className="text-xs text-red-400 font-mono bg-red-50 rounded px-3 py-2 text-left break-words">
            {error.message}
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={onReset}
            className="px-5 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
          >
            重試
          </button>
          {onSkip && (
            <button
              onClick={onSkip}
              className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              跳過此步驟
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StepErrorBoundary;

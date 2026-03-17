import React, { useEffect, useRef, useState } from 'react';

interface SessionTimeoutWarningProps {
  /** Whether the warning modal is visible. */
  visible: boolean;
  /** Seconds remaining before the session is considered expired. */
  countdownSeconds: number;
  /** Called when the user clicks "繼續學習" — resets the idle timer. */
  onContinue: () => void;
  /** Called when the countdown reaches zero — navigates away or reloads. */
  onExpired: () => void;
}

/**
 * Modal overlay shown when the user has been idle and their learning session
 * is about to be lost.  Counts down to zero; if ignored the session is
 * treated as expired and onExpired fires.
 *
 * Accessibility: focus is trapped inside the modal while it is open.
 */
const SessionTimeoutWarning: React.FC<SessionTimeoutWarningProps> = ({
  visible,
  countdownSeconds,
  onContinue,
  onExpired,
}) => {
  const [remaining, setRemaining] = useState(countdownSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  // Reset countdown whenever the modal becomes visible
  useEffect(() => {
    if (!visible) {
      setRemaining(countdownSeconds);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setRemaining(countdownSeconds);

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [visible, countdownSeconds]);

  // Auto-expire when countdown hits zero
  useEffect(() => {
    if (visible && remaining === 0) {
      onExpired();
    }
  }, [visible, remaining, onExpired]);

  // Auto-focus the continue button when modal opens
  useEffect(() => {
    if (visible) {
      // Small delay so the DOM has rendered
      const id = setTimeout(() => continueButtonRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [visible]);

  if (!visible) return null;

  const pct = Math.round((remaining / countdownSeconds) * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-timeout-title"
      aria-describedby="session-timeout-desc"
    >
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 space-y-4">
        {/* Icon + title */}
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center text-xl"
            aria-hidden="true"
          >
            ⏰
          </div>
          <div>
            <h2
              id="session-timeout-title"
              className="text-base font-bold text-gray-900"
            >
              學習 Session 即將逾時
            </h2>
            <p
              id="session-timeout-desc"
              className="text-sm text-gray-500 mt-0.5"
            >
              偵測到長時間無操作，學習進度已自動儲存
            </p>
          </div>
        </div>

        {/* Countdown ring */}
        <div className="flex flex-col items-center gap-2 py-2">
          <div
            className="relative w-16 h-16"
            role="timer"
            aria-label={`剩餘 ${remaining} 秒`}
            aria-live="polite"
            aria-atomic="true"
          >
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="6"
              />
              <circle
                cx="32"
                cy="32"
                r="28"
                fill="none"
                stroke={pct > 40 ? '#f59e0b' : '#ef4444'}
                strokeWidth="6"
                strokeDasharray={`${2 * Math.PI * 28}`}
                strokeDashoffset={`${2 * Math.PI * 28 * (1 - pct / 100)}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
              />
            </svg>
            <span
              className="absolute inset-0 flex items-center justify-center text-xl font-bold text-gray-800"
              aria-hidden="true"
            >
              {remaining}
            </span>
          </div>
          <p className="text-xs text-gray-400">秒後自動結束</p>
        </div>

        {/* Saved progress notice */}
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-700 flex items-center gap-2">
          <span aria-hidden="true">✓</span>
          <span>目前步驟已儲存，可從上次繼續</span>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            ref={continueButtonRef}
            type="button"
            onClick={onContinue}
            className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-2.5 rounded-xl transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            繼續學習
          </button>
          <button
            type="button"
            onClick={onExpired}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-2 rounded-xl transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            離開並儲存
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionTimeoutWarning;

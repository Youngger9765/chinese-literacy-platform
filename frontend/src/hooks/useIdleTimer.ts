import { useEffect, useRef, useCallback } from 'react';

interface UseIdleTimerOptions {
  /** Milliseconds of inactivity before the onIdle callback fires. */
  timeout: number;
  /** Called when the user has been idle for `timeout` ms. */
  onIdle: () => void;
  /** Whether the timer is active. Pass false to disable (e.g. outside learning flow). */
  enabled?: boolean;
}

/**
 * Detects user inactivity and calls onIdle after the specified timeout.
 * Resets on any mouse move, keydown, touchstart, or click event.
 *
 * Returns a `reset` function so the caller can manually reset the timer
 * (e.g. when the user clicks "繼續學習" in the warning modal).
 */
export function useIdleTimer({
  timeout,
  onIdle,
  enabled = true,
}: UseIdleTimerOptions): { reset: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);

  // Keep the latest callback without re-registering listeners
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  const reset = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      onIdleRef.current();
    }, timeout);
  }, [timeout]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const;

    const handleActivity = () => reset();

    EVENTS.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));

    // Start the initial timer
    reset();

    return () => {
      EVENTS.forEach((ev) => window.removeEventListener(ev, handleActivity));
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, reset]);

  return { reset };
}

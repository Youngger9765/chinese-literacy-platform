/**
 * useAsyncAction — thin wrapper for async actions with loading/error state.
 *
 * Replaces repetitive `isLoading / setIsLoading / setError / try-catch`
 * blocks in admin panels.
 *
 * Usage:
 *   const { run, isLoading, error, clearError } = useAsyncAction();
 *
 *   const handleSave = async () => {
 *     const ok = await run(async () => {
 *       await api.updateOrg(token, id, data);
 *     });
 *     if (ok) setIsEditing(false);
 *   };
 */
import { useState, useCallback } from 'react';

export interface UseAsyncActionResult {
  /**
   * Execute an async function.  Returns true if it resolved without throwing,
   * false if it threw.  The caught error message is stored in `error`.
   */
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
  /** True while the wrapped function is executing. */
  isLoading: boolean;
  /** Error message from the last failed run, or '' when clear. */
  error: string;
  /** Manually clear the error state. */
  clearError: () => void;
}

export function useAsyncAction(): UseAsyncActionResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const clearError = useCallback(() => setError(''), []);

  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setIsLoading(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('發生錯誤，請稍後再試');
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { run, isLoading, error, clearError };
}

/**
 * useProgressSync — DB sync layer for step progress (Issue #660).
 *
 * Strategy:
 * - localStorage = L1 cache (immediate, always works)
 * - DB = L2 store   (durable, requires session + token)
 *
 * On mount (when dbSessionId becomes available):
 *   1. GET progress from DB
 *   2. If DB has data, merge it with localStorage (DB wins for completed steps)
 *   3. Call onProgressLoaded with the merged result so LearningLayout can
 *      restore state from a previous browser session
 *
 * On progress update:
 *   - Caller invokes syncProgress(data) which:
 *     a. Writes to localStorage immediately (via callback)
 *     b. Debounces a PUT to the DB (5 seconds)
 *
 * API failures are fully non-blocking — localStorage still functions.
 */
import { useCallback, useEffect, useRef } from 'react';
import { saveStepProgress, saveStepProgressBeacon, loadStepProgress, StepProgressData } from '../services/learningApi';

const DEBOUNCE_MS = 5_000;

export interface UseProgressSyncOptions {
  /** Auth token for DB API calls. Null when unauthenticated. */
  token: string | null;
  /** DB LearningSession integer ID. Null until the session is created. */
  dbSessionId: number | null;
  /**
   * Called once after the initial DB load resolves with a non-null result.
   * Use this to hydrate in-memory state from the DB on page load / refresh.
   */
  onProgressLoaded?: (data: StepProgressData) => void;
}

export interface UseProgressSyncReturn {
  /**
   * Sync progress to DB (debounced 5 s) and to localStorage immediately.
   * API failures are swallowed — localStorage write still happens.
   */
  syncProgress: (data: StepProgressData) => void;
  /** Force an immediate DB save (e.g. on step completion). */
  flushProgress: (data: StepProgressData) => void;
}

export function useProgressSync({
  token,
  dbSessionId,
  onProgressLoaded,
}: UseProgressSyncOptions): UseProgressSyncReturn {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDataRef = useRef<StepProgressData | null>(null);

  // ── Initial load from DB ──────────────────────────────────────────────────
  useEffect(() => {
    if (!token || dbSessionId === null) return;

    loadStepProgress(token, dbSessionId)
      .then((res) => {
        if (res.step_progress && onProgressLoaded) {
          onProgressLoaded(res.step_progress);
        }
      })
      .catch(() => {
        // Non-fatal: fallback to localStorage handled by caller
      });
    // Only run once when dbSessionId first becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSessionId, token]);

  // ── Flush helper ──────────────────────────────────────────────────────────
  const doSave = useCallback(
    (data: StepProgressData) => {
      if (!token || dbSessionId === null) return;
      saveStepProgress(token, dbSessionId, data).catch(() => {
        // Non-fatal — localStorage already has the data
      });
    },
    [token, dbSessionId],
  );

  // Keep a ref to the latest doSave so unmount cleanup always uses the current version
  const doSaveRef = useRef(doSave);
  useEffect(() => { doSaveRef.current = doSave; }, [doSave]);

  // ── Debounced sync ────────────────────────────────────────────────────────
  const syncProgress = useCallback(
    (data: StepProgressData) => {
      latestDataRef.current = data;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        if (latestDataRef.current) {
          doSaveRef.current(latestDataRef.current);
        }
        debounceTimerRef.current = null;
      }, DEBOUNCE_MS);
    },
    [doSave],
  );

  // ── Immediate flush ───────────────────────────────────────────────────────
  const flushProgress = useCallback(
    (data: StepProgressData) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      latestDataRef.current = data;
      doSave(data);
    },
    [doSave],
  );

  // Flush pending data on page unload (refresh / close / navigate away)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!latestDataRef.current || !debounceTimerRef.current) return;

      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;

      if (token && dbSessionId !== null) {
        saveStepProgressBeacon(token, dbSessionId, latestDataRef.current);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [token, dbSessionId]);

  // Flush pending data on unmount (SPA navigation away from learning flow)
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        if (latestDataRef.current) {
          doSaveRef.current(latestDataRef.current);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { syncProgress, flushProgress };
}

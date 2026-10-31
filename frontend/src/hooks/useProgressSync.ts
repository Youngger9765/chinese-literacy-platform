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
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  saveStepProgress,
  saveStepProgressBeacon,
  loadStepProgress,
  StaleVersionError,
  StepProgressData,
  ReadingBabyGrowthEvent,
} from '../services/learningApi';

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
  /** Called with the server's stored progress after every successful save (#3694). */
  onProgressSaved?: (data: StepProgressData) => void;
  /**
   * Issue #3024 — called after a successful save when the backend awarded
   * XP and/or unlocked badges for a newly-completed step mid-session. NOT
   * called for saves that persisted step_data with no new completed step
   * (the common case), nor for the initial GET load.
   */
  onXpAwarded?: (result: { xpAwarded: number; badgesUnlocked: string[] }) => void;
  /**
   * Issue #3780 reading-babies phase 2 — called after a successful save when
   * the backend recorded one or more reading-baby growth events for a
   * newly-completed step mid-session. NOT called for saves whose
   * `reading_baby_events` is absent or empty (the common case), nor for the
   * initial GET load. Mirrors onXpAwarded's wiring exactly (#3024).
   */
  onReadingBabyGrowth?: (events: ReadingBabyGrowthEvent[]) => void;
}

export interface UseProgressSyncReturn {
  /**
   * Sync progress to DB (debounced 5 s) and to localStorage immediately.
   * API failures are swallowed — localStorage write still happens.
   */
  syncProgress: (data: StepProgressData) => void;
  /** Force an immediate DB save (e.g. on step completion). */
  flushProgress: (data: StepProgressData) => void;
  /**
   * True while the initial load from DB is in flight (Issue #1549).
   * Caller should gate child renders that depend on step_progress so they
   * don't initialise local state from an empty stepProgressData and then
   * fail to re-init once the async load completes.
   */
  isProgressLoading: boolean;
}

export function useProgressSync({
  token,
  dbSessionId,
  onProgressLoaded,
  onProgressSaved,
  onXpAwarded,
  onReadingBabyGrowth,
}: UseProgressSyncOptions): UseProgressSyncReturn {
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDataRef = useRef<StepProgressData | null>(null);
  // Monotonic version tracking (#1187): last-known server version + in-flight client bump
  const lastServerVersionRef = useRef<number>(0);
  // Issue #1549 — derive "loading" synchronously from a one-shot
  // `hasLoadedOnce` flag plus the input props. We do NOT use a separate
  // setIsLoading state, because doing so would lag one render behind the
  // dbSessionId transition and let children mount with an empty snapshot.
  //
  // isProgressLoading is true whenever we *would* be loading from DB
  // (both token and dbSessionId present) but the first load hasn't yet
  // resolved. The flag flips on first .finally() of the load effect.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const isProgressLoading = !!token && dbSessionId !== null && !hasLoadedOnce;
  // Issue #3682 (production root cause, fix A) — mirror `hasLoadedOnce` in a
  // ref so doSave / the unload beacon below can synchronously check the
  // LATEST loaded state without needing it in their own dependency arrays
  // (adding it there would recreate doSave every render once loaded).
  const hasLoadedOnceRef = useRef(false);

  // Stash onProgressLoaded behind a ref so the doSave / syncProgress / flushProgress
  // identities don't change every render when the caller passes an inline arrow.
  // Without this, every LearningLayout re-render minted new callback references,
  // which propagated through useOutletContext → child useEffect deps → fired the
  // step-data sync on every render, bursting the rate-limited PUT endpoint.
  const onProgressLoadedRef = useRef(onProgressLoaded);
  useEffect(() => { onProgressLoadedRef.current = onProgressLoaded; }, [onProgressLoaded]);
  const onProgressSavedRef = useRef(onProgressSaved);
  useEffect(() => { onProgressSavedRef.current = onProgressSaved; }, [onProgressSaved]);
  const onXpAwardedRef = useRef(onXpAwarded);
  useEffect(() => { onXpAwardedRef.current = onXpAwarded; }, [onXpAwarded]);
  const onReadingBabyGrowthRef = useRef(onReadingBabyGrowth);
  useEffect(() => { onReadingBabyGrowthRef.current = onReadingBabyGrowth; }, [onReadingBabyGrowth]);

  const readStoredVersion = (data: StepProgressData | null | undefined): number => {
    const v = data?.version;
    return typeof v === 'number' && v >= 0 ? v : 0;
  };

  // ── Initial load from DB ──────────────────────────────────────────────────
  useEffect(() => {
    if (!token || dbSessionId === null) return;

    // If we're loading for a fresh session (e.g. dbSessionId just transitioned
    // from null → id), reset the loaded flag so isProgressLoading flips back
    // to true synchronously on the next render.
    setHasLoadedOnce(false);
    hasLoadedOnceRef.current = false;
    loadStepProgress(token, dbSessionId)
      .then((res) => {
        const stepProgress = res.step_progress;
        if (stepProgress) {
          lastServerVersionRef.current = readStoredVersion(stepProgress);
          onProgressLoadedRef.current?.(stepProgress);
        }
      })
      .catch(() => {
        // Non-fatal: fallback to localStorage handled by caller
      })
      .finally(() => {
        setHasLoadedOnce(true);
        hasLoadedOnceRef.current = true;
      });
    // Only run once when dbSessionId first becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbSessionId, token]);

  // ── Flush helper ──────────────────────────────────────────────────────────
  // Issue #3785 (recurrence of #3694/#3707): a step's "下一關" click fires TWO
  // immediate flushes back to back in the SAME tick — one plain progress-data
  // save, one that carries the just-finished step (see e.g.
  // KeypointsTablePage.handleNext). Both used to call doSave() synchronously,
  // both reading the SAME lastServerVersionRef (neither had resolved yet to
  // bump it) — a self-inflicted race between two saves from this SAME hook
  // instance. The loser got a 409 and was resent once at the fresh version,
  // but if that lone retry also lost a race (e.g. against keypoints-table's
  // own slow submit-grading debounce save), the data was dropped silently —
  // no further retry, and no pending debounce timer left for the
  // beforeunload/pagehide beacon to pick up either.
  //
  // Fix: never let two saves FROM THIS HOOK talk to the server concurrently.
  // `saveQueueRef.inFlight` gates it; a save request that arrives while one
  // is already in flight is queued as `pending` (overwriting any earlier
  // pending snapshot — progress only ever grows, so the latest snapshot is
  // always a superset) and sent right after the in-flight one fully settles
  // (including its own retry, if any), at the by-then-correct version.
  //
  // Known narrow limitation this does NOT cover (PR review, #3785): a save
  // left sitting in `pending` is only ever sent from the in-flight save's own
  // `.finally()` below — neither the unmount-cleanup effect nor the
  // beforeunload/pagehide `flushBeacon` (bottom of this file) know to flush
  // it. If the tab closes in the sub-second window between a save being
  // queued and the in-flight one settling, the queued save is lost. This is
  // layered on top of a pre-existing gap — `flushBeacon` already never covers
  // ANY flushProgress()-sourced save, queued or not, single or concurrent
  // (its guard only fires for a pending *debounce* timer, which
  // flushProgress always clears) — but queuing does mean a save that used to
  // at least get dispatched immediately (with some non-zero chance of
  // finishing before teardown) now provably waits. Accepted as-is: the window
  // is a double-flush landing inside a sub-second unload race, and fixing the
  // beacon's blind spot for flushProgress saves in general is a separate,
  // pre-existing problem, not something to grow here.
  const saveQueueRef = useRef<{ inFlight: boolean; pending: StepProgressData | null }>({
    inFlight: false,
    pending: null,
  });
  // Declared before doSave (and kept current by the effect right after it) so
  // doSave can dequeue-and-resend itself without a use-before-define — same
  // indirection #3694 already used for the single retry (formerly
  // `retrySaveRef`), now also covering unmount cleanup's own use of this ref.
  const doSaveRef = useRef<(data: StepProgressData) => void>(() => {});
  const doSave = useCallback(
    (data: StepProgressData) => {
      if (!token || dbSessionId === null) return;
      // Issue #3682 fix A (production root cause) — never PUT before the
      // initial GET has resolved and been merged into the caller's state.
      // A save queued while that GET is still in flight is built from a
      // stale/empty local snapshot (e.g. a child step page's mount effect
      // firing before onProgressLoaded hydrated state); by the time it
      // would actually fire, lastServerVersionRef has already been updated
      // BY that same GET, so the optimistic-concurrency version check no
      // longer catches it as stale. Drop it — the caller's local state gets
      // correctly re-hydrated by onProgressLoaded, and the next genuine
      // save (post-load) will carry that merged state as its base.
      if (!hasLoadedOnceRef.current) return;

      // Every call entering here is a fresh (non-retry) attempt — retries are
      // handled internally by `attempt()` below via a direct recursive call,
      // NOT by re-entering doSave, specifically so they never queue behind
      // themselves and so `.finally()` (and the queue slot it releases) waits
      // for the retry too. Don't "simplify" the retry to call doSave(d) again
      // — that would reopen the exact race this fix closes (see point 1 in
      // the #3785 PR review: doSave's return type is `void`, so chaining
      // through it would let `.finally()` release the slot before the retry
      // settles).
      if (saveQueueRef.current.inFlight) {
        saveQueueRef.current.pending = data;
        return;
      }
      saveQueueRef.current.inFlight = true;

      // Sends one attempt; on a stale-version rejection, resends ONCE more
      // at the server-reported version (chained via `return`, so the caller
      // below only sees this whole thing as "settled" once any retry has
      // also resolved — that's what keeps the queue slot held long enough).
      // Relies on saveStepProgress being an `async function` (always returns
      // a Promise, even on a synchronous throw) so attempt() can never throw
      // before `.finally()` below attaches — if that ever changes, inFlight
      // could wedge `true` forever.
      const attempt = (d: StepProgressData, retrying: boolean): Promise<void> => {
        const withVersion: StepProgressData = { ...d, version: lastServerVersionRef.current };
        return saveStepProgress(token, dbSessionId, withVersion)
          .then((res) => {
            // Track the new server version for the next save
            if (res.step_progress) {
              lastServerVersionRef.current = readStoredVersion(res.step_progress);
              onProgressSavedRef.current?.(res.step_progress);
            }
            // Issue #3024 — surface mid-session XP/badge awards for a
            // newly-completed step. Absent on old responses / GET-shaped
            // payloads, so this is opt-in and backward compatible.
            const xpAwarded = res.xp_awarded ?? 0;
            const badgesUnlocked = res.badges_unlocked ?? [];
            if (xpAwarded > 0 || badgesUnlocked.length > 0) {
              onXpAwardedRef.current?.({ xpAwarded, badgesUnlocked });
            }
            // Issue #3780 reading-babies phase 2 — surface reading-baby
            // growth events the same way, absent on old responses / GET-shaped
            // payloads (backward compat). Merged forward into `attempt()`
            // (#3785's queue-serialized save path) — this used to be a
            // second, now-duplicate inline call to saveStepProgress sitting
            // directly in doSave; that whole branch is gone, attempt() is
            // the only place a save actually happens.
            const readingBabyEvents = res.reading_baby_events ?? [];
            if (readingBabyEvents.length > 0) {
              onReadingBabyGrowthRef.current?.(readingBabyEvents);
            }
          })
          .catch((err) => {
            if (err instanceof StaleVersionError) {
              // Refresh from server; next save will use the newer version
              lastServerVersionRef.current = err.storedVersion;
              loadStepProgress(token, dbSessionId)
                .then((res) => {
                  if (res.step_progress) onProgressLoadedRef.current?.(res.step_progress);
                })
                .catch(() => {});
              // Issue #3694: the rejected save may be the only one carrying a
              // step the student just finished. The server only ever adds
              // completed steps, so resending it at the new version cannot
              // erase anything. One retry only, so two tabs can't ping-pong.
              if (!retrying) return attempt(d, true);
            }
            // Other errors, or an already-retried stale version: non-fatal —
            // localStorage already has the data, and (for the retry-exhausted
            // stale-version case) onProgressLoaded above just re-hydrated
            // local state from the server without losing this step, per the
            // union merge in mergeLoadedStepProgress.
          });
      };

      attempt(data, false).finally(() => {
        saveQueueRef.current.inFlight = false;
        const next = saveQueueRef.current.pending;
        if (next) {
          saveQueueRef.current.pending = null;
          doSaveRef.current(next);
        }
      });
    },
    [token, dbSessionId],
  );

  // Keep doSaveRef pointed at the latest doSave so unmount cleanup and
  // doSave's own queue-drain always use the current version.
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

  // Flush pending data on page unload (refresh / close / navigate away / tab hide).
  //
  // We listen to three events because no single one is reliable across browsers:
  //   - beforeunload : desktop refresh / close (ignored on iOS Safari)
  //   - pagehide     : reliable replacement for beforeunload on mobile + bfcache
  //   - visibilitychange→hidden : fires when user switches apps on mobile
  //     (the only signal an iOS Safari → home-screen transition produces)
  useEffect(() => {
    const flushBeacon = () => {
      if (!latestDataRef.current || !debounceTimerRef.current) return;

      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;

      // Issue #3682 fix A — same guard as doSave: never beacon a save built
      // from a pre-load stale snapshot.
      if (token && dbSessionId !== null && hasLoadedOnceRef.current) {
        saveStepProgressBeacon(token, dbSessionId, {
          ...latestDataRef.current,
          version: lastServerVersionRef.current,
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushBeacon();
    };

    window.addEventListener('beforeunload', flushBeacon);
    window.addEventListener('pagehide', flushBeacon);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushBeacon);
      window.removeEventListener('pagehide', flushBeacon);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

  return { syncProgress, flushProgress, isProgressLoading };
}

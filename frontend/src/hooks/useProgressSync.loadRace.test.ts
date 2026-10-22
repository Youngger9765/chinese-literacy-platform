/**
 * TDD tests for #3682 production root cause (fix A) — the frontend race
 * condition in useProgressSync.
 *
 * Production evidence (scratchpad/teacher-audit/recheck-prod.log, case (a)):
 * reopening the same lesson repeatedly produced PUTs like
 *   v8 200 [reopen1] cur=keypoints-table done=[]
 * i.e. steps_completed=[] got sent to the backend, built from a LOCAL
 * snapshot that was taken before the initial GET load had resolved and
 * merged into state. Root cause: `doSave` (and the unload-beacon flush)
 * only checked `token`/`dbSessionId` — never whether the initial
 * `loadStepProgress()` GET had actually resolved — so a save queued while
 * that GET was still in flight would fire later using the stale,
 * pre-load (effectively empty) snapshot, with a version number that by
 * then matched the server's (because the GET had since updated
 * lastServerVersionRef), slipping straight past the optimistic-concurrency
 * check.
 *
 * This must be RED on the parent commit (before the `hasLoadedOnce` gate
 * is added to doSave / the unload beacon) and GREEN after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProgressSync } from './useProgressSync';

const saveStepProgressMock = vi.fn();
const saveStepProgressBeaconMock = vi.fn();
const loadStepProgressMock = vi.fn();

vi.mock('../services/learningApi', () => ({
  saveStepProgress: (...args: unknown[]) => saveStepProgressMock(...args),
  saveStepProgressBeacon: (...args: unknown[]) => saveStepProgressBeaconMock(...args),
  loadStepProgress: (...args: unknown[]) => loadStepProgressMock(...args),
  StaleVersionError: class StaleVersionError extends Error {
    storedVersion: number;
    incomingVersion: number;
    constructor(storedVersion: number, incomingVersion: number) {
      super('stale version');
      this.storedVersion = storedVersion;
      this.incomingVersion = incomingVersion;
    }
  },
}));

describe('useProgressSync — load race (#3682 fix A)', () => {
  beforeEach(() => {
    saveStepProgressMock.mockReset();
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
    });
    saveStepProgressBeaconMock.mockReset();
    loadStepProgressMock.mockReset();
  });

  it('flushProgress called before the initial GET resolves must NOT PUT, even after the GET later resolves', async () => {
    // The GET never resolves within this test (we control it manually) —
    // simulates the real-world window between dbSessionId becoming available
    // and the network round-trip completing.
    let resolveLoad!: (v: { session_id: number; step_progress: unknown }) => void;
    loadStepProgressMock.mockReturnValue(
      new Promise((resolve) => { resolveLoad = resolve; }),
    );

    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1 }),
    );

    // A child step page mounts before load resolves (the real #3682 window)
    // and fires an immediate save built from an empty/default local snapshot.
    act(() => {
      result.current.flushProgress({
        current_step: 'keypoints-table',
        steps_completed: [],
        step_data: {},
      });
    });

    expect(saveStepProgressMock).not.toHaveBeenCalled();

    // Now the GET resolves — with real stored progress server-side that the
    // premature flush above did NOT know about.
    await act(async () => {
      resolveLoad({
        session_id: 1,
        step_progress: {
          current_step: 'vocab-application',
          steps_completed: ['full-text-annotate', 'key-passage-reading'],
          step_data: {},
          version: 7,
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale pre-load flush must not have been silently replayed once
    // loading completed — it must simply never have reached the server.
    expect(saveStepProgressMock).not.toHaveBeenCalled();
  });

  it('syncProgress (debounced) scheduled before the GET resolves must NOT PUT once the debounce timer elapses', async () => {
    vi.useFakeTimers();
    try {
      let resolveLoad!: (v: { session_id: number; step_progress: unknown }) => void;
      loadStepProgressMock.mockReturnValue(
        new Promise((resolve) => { resolveLoad = resolve; }),
      );

      const { result } = renderHook(() =>
        useProgressSync({ token: 't', dbSessionId: 1 }),
      );

      act(() => {
        result.current.syncProgress({
          current_step: 'keypoints-table',
          steps_completed: [],
          step_data: {},
        });
      });

      // Debounce elapses WHILE the GET is still in flight.
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
      });
      expect(saveStepProgressMock).not.toHaveBeenCalled();

      // GET resolves afterwards.
      await act(async () => {
        resolveLoad({
          session_id: 1,
          step_progress: {
            current_step: 'vocab-application',
            steps_completed: ['full-text-annotate'],
            step_data: {},
            version: 3,
          },
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(saveStepProgressMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the unload beacon (pagehide) must NOT fire while the initial GET is still in flight', async () => {
    let resolveLoad!: (v: { session_id: number; step_progress: unknown }) => void;
    loadStepProgressMock.mockReturnValue(
      new Promise((resolve) => { resolveLoad = resolve; }),
    );

    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1 }),
    );

    act(() => {
      result.current.syncProgress({
        current_step: 'keypoints-table',
        steps_completed: [],
        step_data: {},
      });
    });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(saveStepProgressBeaconMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad({ session_id: 1, step_progress: null });
      await Promise.resolve();
    });
  });

  it('regression guard: flushProgress still saves normally once the initial GET has resolved', async () => {
    loadStepProgressMock.mockResolvedValue({ session_id: 1, step_progress: null });
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
    });

    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1 }),
    );

    // Let the initial GET resolve first.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.flushProgress({
        current_step: 'vocab-definition',
        steps_completed: ['vocab-definition'],
        step_data: {},
      });
    });

    expect(saveStepProgressMock).toHaveBeenCalledTimes(1);
  });
});

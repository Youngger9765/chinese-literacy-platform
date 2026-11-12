/**
 * Regression test for #3785 (recurrence of #3694/#3707): the keypoints-table
 * step's completion can be silently dropped even though the student saw the
 * app accept it and move on.
 *
 * Root cause: every step's "下一關" click fires TWO immediate flushes back to
 * back, synchronously, in the same tick — see KeypointsTablePage.handleNext /
 * SpotlightPage.handleNext etc.:
 *
 *   handleProgressChange({ completed: true }, true);  // flushProgress #1 — no completed step yet
 *   handleFinishStoryStructure();                      // flushProgress #2 — carries the completed step
 *
 * Before this fix, doSave() fired BOTH as separate concurrent PUTs, both
 * reading the SAME `lastServerVersionRef.current` (neither had resolved yet
 * to bump it). Whichever the server processed first won; the loser got a 409
 * stale-version rejection and was resent ONCE at the fresh version — but if
 * that lone retry also lost a race (e.g. against keypoints-table's own slow
 * submit-grading debounce save, which #3785's CI flake traced to), the data
 * was dropped for good: no further retry, and no pending debounce timer left
 * for the beforeunload/pagehide beacon to pick up either.
 *
 * The fix serializes doSave(): a save already talking to the server is never
 * raced by a second one — the newer snapshot is queued and sent right after
 * the first settles, at the by-then-correct version. This must be RED on the
 * parent commit (doSave fires concurrently) and GREEN after serialization.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProgressSync } from './useProgressSync';

const saveStepProgressMock = vi.fn();
const loadStepProgressMock = vi.fn();

vi.mock('../services/learningApi', () => ({
  saveStepProgress: (...args: unknown[]) => saveStepProgressMock(...args),
  saveStepProgressBeacon: vi.fn(),
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

describe('useProgressSync — concurrent flushProgress calls (#3785)', () => {
  beforeEach(() => {
    saveStepProgressMock.mockReset();
    loadStepProgressMock.mockReset();
    loadStepProgressMock.mockResolvedValue({ session_id: 1, step_progress: null });
  });

  it('serializes two back-to-back flushProgress calls instead of racing them at the same version', async () => {
    let resolveFirst!: (v: unknown) => void;
    saveStepProgressMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    saveStepProgressMock.mockResolvedValueOnce({
      session_id: 1,
      step_progress: { current_step: 'spotlight', steps_completed: ['keypoints-table'], step_data: {}, version: 2 },
    });

    const { result } = renderHook(() => useProgressSync({ token: 't', dbSessionId: 1 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      // call A — handleProgressChange({completed:true}, true): no completed step yet.
      result.current.flushProgress({ current_step: 'keypoints-table', steps_completed: [], step_data: {} });
      // call B — handleFinishStoryStructure(), fired synchronously right after
      // (same tick, same as KeypointsTablePage.handleNext): carries the step
      // that just finished.
      result.current.flushProgress({ current_step: 'spotlight', steps_completed: ['keypoints-table'], step_data: {} });
    });

    // Call A's PUT is still in flight (unresolved). Call B must NOT have gone
    // out concurrently at the same stale version — it must wait its turn.
    expect(saveStepProgressMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({
        session_id: 1,
        step_progress: { current_step: 'keypoints-table', steps_completed: [], step_data: {}, version: 1 },
      });
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // Call B's data must now have gone out, carrying the completed step,
    // at the freshly-updated version — not dropped.
    expect(saveStepProgressMock).toHaveBeenCalledTimes(2);
    const second = saveStepProgressMock.mock.calls[1][2];
    expect(second.steps_completed).toEqual(['keypoints-table']);
    expect(second.version).toBe(1);
  });

  it('a third flushProgress call made while two are already queued only sends the latest snapshot once the first settles', async () => {
    let resolveFirst!: (v: unknown) => void;
    saveStepProgressMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'report', steps_completed: ['keypoints-table', 'spotlight'], step_data: {}, version: 2 },
    });

    const { result } = renderHook(() => useProgressSync({ token: 't', dbSessionId: 1 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    act(() => {
      result.current.flushProgress({ current_step: 'keypoints-table', steps_completed: [], step_data: {} });
      result.current.flushProgress({ current_step: 'spotlight', steps_completed: ['keypoints-table'], step_data: {} });
      result.current.flushProgress({ current_step: 'report', steps_completed: ['keypoints-table', 'spotlight'], step_data: {} });
    });

    expect(saveStepProgressMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({
        session_id: 1,
        step_progress: { current_step: 'keypoints-table', steps_completed: [], step_data: {}, version: 1 },
      });
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // Only the LATEST queued snapshot is sent (coalesced) — not the
    // intermediate second call. Total: first attempt + one coalesced resend.
    expect(saveStepProgressMock).toHaveBeenCalledTimes(2);
    const second = saveStepProgressMock.mock.calls[1][2];
    expect(second.steps_completed).toEqual(['keypoints-table', 'spotlight']);
  });
});

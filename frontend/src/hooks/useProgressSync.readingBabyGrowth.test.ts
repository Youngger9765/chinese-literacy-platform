/**
 * TDD tests for useProgressSync's #3780 reading-babies phase 2
 * onReadingBabyGrowth wiring (replaces the deleted
 * useProgressSync.wordBabyRewards.test.ts — v1 整套移除，見 game-design.md §5).
 *
 * Mirrors useProgressSync.xpAwarded.test.ts (#3024) exactly — same mocking
 * pattern, same "let the initial GET settle first" structure (doSave
 * requires hasLoadedOnce before it will PUT, #3682 fix A).
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

describe('useProgressSync — onReadingBabyGrowth (#3780 reading-babies phase 2)', () => {
  beforeEach(() => {
    saveStepProgressMock.mockReset();
    loadStepProgressMock.mockReset();
    loadStepProgressMock.mockResolvedValue({ session_id: 1, step_progress: null });
  });

  const settleInitialLoad = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('calls onReadingBabyGrowth when the save response carries a growth event', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      xp_awarded: 3,
      badges_unlocked: [],
      reading_baby_events: [
        { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
      ],
    });
    const onReadingBabyGrowth = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onReadingBabyGrowth }),
    );

    await settleInitialLoad();

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: ['vocab-definition'], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onReadingBabyGrowth).toHaveBeenCalledWith([
      { station: 'vocab-definition', ability_id: '4-Ⅱ-3', quality_passed: true },
    ]);
  });

  it('does NOT call onReadingBabyGrowth for an ordinary save with an empty events list (the common case)', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      xp_awarded: 0,
      badges_unlocked: [],
      reading_baby_events: [],
    });
    const onReadingBabyGrowth = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onReadingBabyGrowth }),
    );

    await settleInitialLoad();

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: [], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onReadingBabyGrowth).not.toHaveBeenCalled();
  });

  it('does NOT throw when onReadingBabyGrowth is omitted and the response carries no reading_baby_events field (old-shaped response)', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
    });
    const { result } = renderHook(() => useProgressSync({ token: 't', dbSessionId: 1 }));

    await settleInitialLoad();

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: [], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    // No assertion needed beyond "didn't throw" — this locks backward compat.
  });

  /**
   * Same queue-serialization guarantee the v1 test locked (#3785's
   * concurrentFlush queue) — a queued second save surfaces ITS OWN
   * response's growth events exactly once, not the first call's and not
   * twice.
   */
  it('a queued second save (fired while the first is still in flight) surfaces ITS OWN response\'s growth events exactly once, not the first call\'s and not twice', async () => {
    let resolveFirst!: (v: unknown) => void;
    saveStepProgressMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    saveStepProgressMock.mockResolvedValueOnce({
      session_id: 1,
      step_progress: { current_step: 'y', steps_completed: ['key-passage-reading'], step_data: {}, version: 2 },
      reading_baby_events: [
        { station: 'key-passage-reading', ability_id: '5-Ⅱ-1', quality_passed: true },
      ],
    });

    const onReadingBabyGrowth = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onReadingBabyGrowth }),
    );
    await settleInitialLoad();

    act(() => {
      // Call A — carries a growth event in its (not-yet-resolved) response.
      result.current.flushProgress({ current_step: 'x', steps_completed: ['vocab-definition'], step_data: {} });
      // Call B — fired synchronously right after, same tick: must queue
      // behind A, not race it.
      result.current.flushProgress({ current_step: 'y', steps_completed: ['vocab-definition', 'key-passage-reading'], step_data: {} });
    });

    // A's PUT is still unresolved — B must not have gone out yet, and
    // nothing should have been announced yet either.
    expect(saveStepProgressMock).toHaveBeenCalledTimes(1);
    expect(onReadingBabyGrowth).not.toHaveBeenCalled();

    await act(async () => {
      // A resolves with NO growth event of its own.
      resolveFirst({
        session_id: 1,
        step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
        reading_baby_events: [],
      });
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // B has now gone out and resolved (its mock is queued above) — its
    // growth event must have fired exactly once, carrying its own station,
    // not fired for A's empty response and not fired twice.
    expect(saveStepProgressMock).toHaveBeenCalledTimes(2);
    expect(onReadingBabyGrowth).toHaveBeenCalledTimes(1);
    expect(onReadingBabyGrowth).toHaveBeenCalledWith([
      { station: 'key-passage-reading', ability_id: '5-Ⅱ-1', quality_passed: true },
    ]);
  });
});

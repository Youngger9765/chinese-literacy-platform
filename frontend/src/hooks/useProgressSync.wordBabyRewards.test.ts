/**
 * TDD tests for useProgressSync's #3780 接島上 onWordBabyRewarded wiring.
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

describe('useProgressSync — onWordBabyRewarded (#3780 接島上)', () => {
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

  it('calls onWordBabyRewarded when the save response carries a reward', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      xp_awarded: 3,
      badges_unlocked: [],
      word_baby_rewards: [
        {
          id: 1,
          station: 'vocab-definition',
          fragment_awarded: true,
          fragment_flavor: '語文基礎',
          encounter_result: 'none',
          encounter_baby_id: null,
        },
      ],
    });
    const onWordBabyRewarded = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onWordBabyRewarded }),
    );

    await settleInitialLoad();

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: ['vocab-definition'], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onWordBabyRewarded).toHaveBeenCalledWith([
      {
        id: 1,
        station: 'vocab-definition',
        fragment_awarded: true,
        fragment_flavor: '語文基礎',
        encounter_result: 'none',
        encounter_baby_id: null,
      },
    ]);
  });

  it('does NOT call onWordBabyRewarded for an ordinary save with an empty rewards list (the common case)', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      xp_awarded: 0,
      badges_unlocked: [],
      word_baby_rewards: [],
    });
    const onWordBabyRewarded = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onWordBabyRewarded }),
    );

    await settleInitialLoad();

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: [], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onWordBabyRewarded).not.toHaveBeenCalled();
  });

  it('does NOT throw when onWordBabyRewarded is omitted and the response carries no word_baby_rewards field (old-shaped response)', async () => {
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
   * code-reviewer finding (merge-conflict review, 2026-10-28): the island
   * branch's #3785 fix (useProgressSync.concurrentFlush.test.ts) serializes
   * doSave() — a second flushProgress() while one is already in flight gets
   * queued and sent after the first settles, at the fresh version — instead
   * of racing both at the stale version. This branch's word_baby_rewards
   * handling had to be merged into that queue's own attempt() closure
   * (see useProgressSync.ts doSave/attempt). Neither test file exercised the
   * intersection: a queue-drained call whose OWN response carries rewards.
   * Team-lead specifically asked this be checked — this is the permanent
   * lock for it (reviewer verified the underlying behavior with a throwaway
   * mutation-tested version of this test first; this is that test, kept).
   */
  it('a queued second save (fired while the first is still in flight) surfaces ITS OWN response\'s rewards exactly once, not the first call\'s and not twice', async () => {
    let resolveFirst!: (v: unknown) => void;
    saveStepProgressMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    saveStepProgressMock.mockResolvedValueOnce({
      session_id: 1,
      step_progress: { current_step: 'y', steps_completed: ['key-passage-reading'], step_data: {}, version: 2 },
      word_baby_rewards: [
        { id: 30, station: 'key-passage-reading', fragment_awarded: true, fragment_flavor: '朗讀表達', encounter_result: 'none', encounter_baby_id: null },
      ],
    });

    const onWordBabyRewarded = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onWordBabyRewarded }),
    );
    await settleInitialLoad();

    act(() => {
      // Call A — carries a reward in its (not-yet-resolved) response.
      result.current.flushProgress({ current_step: 'x', steps_completed: ['vocab-definition'], step_data: {} });
      // Call B — fired synchronously right after, same tick: must queue
      // behind A, not race it.
      result.current.flushProgress({ current_step: 'y', steps_completed: ['vocab-definition', 'key-passage-reading'], step_data: {} });
    });

    // A's PUT is still unresolved — B must not have gone out yet, and
    // nothing should have been announced yet either.
    expect(saveStepProgressMock).toHaveBeenCalledTimes(1);
    expect(onWordBabyRewarded).not.toHaveBeenCalled();

    await act(async () => {
      // A resolves with NO reward of its own.
      resolveFirst({
        session_id: 1,
        step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
        word_baby_rewards: [],
      });
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // B has now gone out and resolved (its mock is queued above) — its
    // reward must have fired exactly once, carrying its own id (30), not
    // fired for A's empty response and not fired twice.
    expect(saveStepProgressMock).toHaveBeenCalledTimes(2);
    expect(onWordBabyRewarded).toHaveBeenCalledTimes(1);
    expect(onWordBabyRewarded).toHaveBeenCalledWith([
      { id: 30, station: 'key-passage-reading', fragment_awarded: true, fragment_flavor: '朗讀表達', encounter_result: 'none', encounter_baby_id: null },
    ]);
  });
});

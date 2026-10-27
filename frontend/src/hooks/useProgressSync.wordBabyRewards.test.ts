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
});

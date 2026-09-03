/**
 * TDD tests for useProgressSync's #3024 onXpAwarded wiring.
 *
 * useStepProgressPersistence.saveStepProgressPatch's "completeStep" path
 * calls flushProgress → doSave → PUT .../progress. The backend (#3024) now
 * returns xp_awarded / badges_unlocked when a newly-completed step earned
 * XP mid-session; this hook must surface that via onXpAwarded WITHOUT
 * disturbing its existing version-tracking / stale-version-retry behavior.
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

describe('useProgressSync — onXpAwarded (#3024)', () => {
  beforeEach(() => {
    saveStepProgressMock.mockReset();
    loadStepProgressMock.mockReset();
    loadStepProgressMock.mockResolvedValue({ session_id: 1, step_progress: null });
  });

  it('calls onXpAwarded when the save response reports newly-awarded XP', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: ['vocab-definition'], step_data: {}, version: 1 },
      xp_awarded: 3,
      badges_unlocked: [],
    });
    const onXpAwarded = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onXpAwarded }),
    );

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: ['vocab-definition'], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onXpAwarded).toHaveBeenCalledWith({ xpAwarded: 3, badgesUnlocked: [] });
  });

  it('calls onXpAwarded with badges even when xp_awarded is 0', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      xp_awarded: 0,
      badges_unlocked: ['xp_500'],
    });
    const onXpAwarded = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onXpAwarded }),
    );

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: [], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onXpAwarded).toHaveBeenCalledWith({ xpAwarded: 0, badgesUnlocked: ['xp_500'] });
  });

  it('does NOT call onXpAwarded for an ordinary save that awarded nothing (the common case)', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
      xp_awarded: 0,
      badges_unlocked: [],
    });
    const onXpAwarded = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onXpAwarded }),
    );

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: [], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onXpAwarded).not.toHaveBeenCalled();
  });

  it('does NOT throw when onXpAwarded is omitted and the response carries no xp fields (old-shaped response)', async () => {
    saveStepProgressMock.mockResolvedValue({
      session_id: 1,
      step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 1 },
    });
    const { result } = renderHook(() => useProgressSync({ token: 't', dbSessionId: 1 }));

    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: [], step_data: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    // No assertion needed beyond "didn't throw" — this locks backward compat.
  });
});

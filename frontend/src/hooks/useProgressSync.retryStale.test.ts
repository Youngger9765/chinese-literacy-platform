/**
 * Regression test for #3694: a save rejected for a stale version is resent
 * once at the new version, so a step it carried is not lost.
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
import { StaleVersionError } from '../services/learningApi';

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

describe('useProgressSync — resend after 409 (#3694)', () => {
  beforeEach(() => {
    saveStepProgressMock.mockReset();
    loadStepProgressMock.mockReset();
    loadStepProgressMock.mockResolvedValue({ session_id: 1, step_progress: null });
  });

  it('resends the rejected save once, at the server version', async () => {
    const ok = { session_id: 1, step_progress: { current_step: 'x', steps_completed: [], step_data: {}, version: 20 } };
    saveStepProgressMock
      .mockRejectedValueOnce(new (StaleVersionError as unknown as new (a: number, b: number) => Error)(19, 18))
      .mockResolvedValue(ok);
    const { result } = renderHook(() => useProgressSync({ token: 't', dbSessionId: 1 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const payload = { current_step: 'spotlight#yqcxe', steps_completed: ['keypoints-table#vhkqd'], step_data: {} };
    await act(async () => {
      result.current.flushProgress(payload);
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(saveStepProgressMock).toHaveBeenCalledTimes(2);
    const resent = saveStepProgressMock.mock.calls[1][2];
    expect(resent.steps_completed).toEqual(['keypoints-table#vhkqd']);
    expect(resent.version).toBe(19);
  });

  it('does not keep resending when the retry is also rejected', async () => {
    saveStepProgressMock.mockRejectedValue(new (StaleVersionError as unknown as new (a: number, b: number) => Error)(19, 18));
    const { result } = renderHook(() => useProgressSync({ token: 't', dbSessionId: 1 }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => {
      result.current.flushProgress({ current_step: 'x', steps_completed: ['a'], step_data: {} });
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(saveStepProgressMock).toHaveBeenCalledTimes(2);
  });
});

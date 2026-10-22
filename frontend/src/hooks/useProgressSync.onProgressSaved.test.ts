/**
 * Regression test for #3694: after a successful save the server's stored
 * progress (which only ever gains completed steps) is handed back to the page.
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

describe('useProgressSync — onProgressSaved (#3694)', () => {
  beforeEach(() => {
    saveStepProgressMock.mockReset();
    loadStepProgressMock.mockReset();
    loadStepProgressMock.mockResolvedValue({ session_id: 1, step_progress: null });
  });

  it('hands the stored progress to onProgressSaved, including steps the page did not send', async () => {
    const stored = {
      current_step: 'spotlight#yqcxe',
      steps_completed: ['full-text-annotate#qeqwt', 'keypoints-table#vhkqd'],
      step_data: {},
      version: 18,
    };
    saveStepProgressMock.mockResolvedValue({ session_id: 1, step_progress: stored });
    const onProgressSaved = vi.fn();
    const { result } = renderHook(() =>
      useProgressSync({ token: 't', dbSessionId: 1, onProgressSaved }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.flushProgress({
        current_step: 'spotlight#yqcxe',
        steps_completed: ['full-text-annotate#qeqwt'],
        step_data: {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onProgressSaved).toHaveBeenCalledWith(stored);
  });
});

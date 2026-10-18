/**
 * TDD regression test for #3494.
 *
 * Hans (client-side QA, PR #3448): "系統把課程簡介也算一關，但那個就是講義下載的
 * 封面，其實沒有過關不過關的問題，所以沒辦法算完成，老師端就看不到學生完成作業".
 *
 * requiredAssignmentSteps (the list an assignment flow must clear before
 * isAssignmentReadyForSubmit can become true) used to exclude only 'report'.
 * 'lesson-intro' (課程簡介) is a cover-page step — nothing in the codebase ever
 * adds it to the persisted steps_completed array (handleStartReading only sets
 * in-memory session.introCompleted), so it stayed permanently "missing" and no
 * assignment-flow student could ever reach isAssignmentReadyForSubmit = true.
 *
 * Same mocking pattern as useStepProgressPersistence.badgeUnlock.test.ts:
 * useProgressSync is mocked so we can drive its onProgressLoaded callback with
 * a synthetic "everything done except lesson-intro/report" payload, the same
 * shape the real PUT .../progress GET-on-mount path hands back.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let capturedOnProgressLoaded:
  | ((data: { current_step: string | null; steps_completed: string[]; step_data: Record<string, unknown> }) => void)
  | undefined;

vi.mock('./useProgressSync', () => ({
  useProgressSync: (opts: {
    onProgressLoaded?: (data: { current_step: string | null; steps_completed: string[]; step_data: Record<string, unknown> }) => void;
  }) => {
    capturedOnProgressLoaded = opts.onProgressLoaded;
    return {
      syncProgress: vi.fn(),
      flushProgress: vi.fn(),
      isProgressLoading: false,
    };
  },
}));

import { useStepProgressPersistence } from './useStepProgressPersistence';
import { resolveActiveSteps } from '../config/stepConfig';

function setup() {
  const setSession = vi.fn();
  const { result } = renderHook(() =>
    useStepProgressPersistence({
      storyId: '99',
      user: { id: 1 } as never,
      token: 'test-token',
      dbSessionId: 1,
      selectedStory: null, // no custom step_sequence -> falls back to DEFAULT_STEP_SEQUENCE
      isAssignmentFlow: true,
      setSession,
    }),
  );
  return { result };
}

describe('useStepProgressPersistence — lesson-intro is not a required assignment step (#3494)', () => {
  it('a student who finished every real step except lesson-intro/report is ready to submit', () => {
    const { result } = setup();
    expect(capturedOnProgressLoaded, 'useStepProgressPersistence must pass onProgressLoaded to useProgressSync').toBeTypeOf('function');

    // Every enabled default-sequence step EXCEPT lesson-intro and report — i.e.
    // the student did all the real work, only the two cover-page-like steps
    // were never (and never could be) marked complete.
    const allActiveStepIds = resolveActiveSteps(undefined).map((s) => s.id);
    const completedExceptIntroAndReport = allActiveStepIds.filter(
      (id) => id !== 'lesson-intro' && id !== 'report',
    );

    act(() => {
      capturedOnProgressLoaded!({
        current_step: 'report',
        steps_completed: completedExceptIntroAndReport,
        step_data: {},
      });
    });

    const missingIds = result.current.missingAssignmentSteps.map((s) => s.id);
    expect(missingIds).not.toContain('lesson-intro');
    expect(missingIds).not.toContain('report');
    expect(missingIds).toEqual([]);
    expect(result.current.isAssignmentReadyForSubmit).toBe(true);
  });

  it('still correctly reports NOT ready when a real step (not lesson-intro) is missing', () => {
    const { result } = setup();
    const allActiveStepIds = resolveActiveSteps(undefined).map((s) => s.id);
    const missingOneRealStep = allActiveStepIds.filter(
      (id) => id !== 'lesson-intro' && id !== 'report' && id !== 'comprehension',
    );

    act(() => {
      capturedOnProgressLoaded!({
        current_step: 'comprehension',
        steps_completed: missingOneRealStep,
        step_data: {},
      });
    });

    const missingIds = result.current.missingAssignmentSteps.map((s) => s.id);
    expect(missingIds).toEqual(['comprehension']);
    expect(result.current.isAssignmentReadyForSubmit).toBe(false);
  });
});

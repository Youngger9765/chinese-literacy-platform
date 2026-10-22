/**
 * TDD tests for #3682 fix C (part 1) — current_step must carry the round
 * slug (`base#slug`), not just steps_completed/step_data.
 *
 * Production evidence (scratchpad/teacher-audit/recheck-prod.log, case (b)):
 * every step page hardcodes `currentStep: '<bare-step-id>'` (identical to its
 * own `stepId`) when calling saveStepProgressPatch — e.g.
 * ComprehensionMcqPage.tsx always passes `currentStep: 'comprehension'`,
 * never `'comprehension#pjhxh'`. saveStepProgressPatch already computes a
 * correctly-keyed `keyed` value (used for completeStep / stepDataPatch, per
 * #2930) but was passing `opts.currentStep` straight through unkeyed. That
 * means the backend's stored `step_progress.current_step` was ALWAYS the
 * bare id for any in-progress multi-passage step — which MyAssignments.tsx's
 * resume link then read verbatim, producing a resume URL with no `?p=`
 * round query param at all (confirmed: "落地網址 /learn/20017/comprehension").
 *
 * Fix: when the caller's `currentStep` equals its own `stepId` (the normal
 * "I am the step reporting my own progress" case — true at every real call
 * site), substitute the already-computed keyed value.
 *
 * Must be RED on the parent commit, GREEN after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const syncProgressMock = vi.fn();
const flushProgressMock = vi.fn();

vi.mock('./useProgressSync', () => ({
  useProgressSync: () => ({
    syncProgress: syncProgressMock,
    flushProgress: flushProgressMock,
    isProgressLoading: false,
  }),
}));

import { useStepProgressPersistence } from './useStepProgressPersistence';

function setup() {
  const setSession = vi.fn();
  const { result } = renderHook(() =>
    useStepProgressPersistence({
      storyId: '99',
      user: { id: 1 } as never,
      token: 'test-token',
      dbSessionId: 1,
      selectedStory: null,
      isAssignmentFlow: false,
      setSession,
    }),
  );
  return { result };
}

describe('useStepProgressPersistence — saveStepProgressPatch keeps current_step round-aware (#3682 fix C)', () => {
  beforeEach(() => {
    syncProgressMock.mockReset();
    flushProgressMock.mockReset();
  });

  it('substitutes the keyed (round-aware) value for current_step when currentStep === stepId, exactly like it already does for completeStep', () => {
    const { result } = setup();

    act(() => {
      result.current.saveStepProgressPatch({
        currentStepKey: 'comprehension#pjhxh',
        stepId: 'comprehension',
        stepData: { answered: 1 },
        currentStep: 'comprehension', // every real call site passes this (hardcoded, always bare)
        markCompleted: true,
        immediate: true,
      });
    });

    expect(flushProgressMock).toHaveBeenCalledTimes(1);
    const saved = flushProgressMock.mock.calls[0][0];
    expect(saved.current_step).toBe('comprehension#pjhxh');
    // Regression guard — completeStep's existing #2930 keying must be untouched.
    expect(saved.steps_completed).toContain('comprehension#pjhxh');
  });

  it('single-passage lessons (no round in currentStepKey) are unaffected — current_step stays the bare id', () => {
    const { result } = setup();

    act(() => {
      result.current.saveStepProgressPatch({
        currentStepKey: 'comprehension', // no `#` — single-passage lesson
        stepId: 'comprehension',
        stepData: {},
        currentStep: 'comprehension',
        immediate: true,
      });
    });

    const saved = flushProgressMock.mock.calls[0][0];
    expect(saved.current_step).toBe('comprehension');
  });

  it('does NOT override currentStep when the caller explicitly targets a DIFFERENT step (transition saves)', () => {
    const { result } = setup();

    act(() => {
      result.current.saveStepProgressPatch({
        currentStepKey: 'comprehension#pjhxh',
        stepId: 'comprehension',
        stepData: {},
        currentStep: 'report', // explicitly advancing to a different step
        markCompleted: true,
        immediate: true,
      });
    });

    const saved = flushProgressMock.mock.calls[0][0];
    expect(saved.current_step).toBe('report');
  });
});

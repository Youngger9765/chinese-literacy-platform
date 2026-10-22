/**
 * Regression tests for Issue #3695 (originally reported as #3682).
 *
 * Production symptom: a student who completed every required step of an
 * assigned lesson was never submitted unless sessionStorage still held
 * `activeAssignmentId`. Opening the lesson in a new tab, restarting the
 * browser, or resuming days later wipes that sessionStorage. The OLD
 * auto-submit trigger (useLearningStepNavigation's handleSessionComplete)
 * read `activeAssignmentId` from sessionStorage directly, so it silently
 * no-opped in exactly that scenario — even though `steps_completed` was
 * being saved to the DB correctly the whole time.
 *
 * `isAssignmentFlow` (useLearningSessionBootstrap.ts) is ITSELF derived from
 * `sessionStorage.getItem('activeAssignmentId')` — it is the thing that goes
 * missing, not a fix for it. So this test drives `useStepProgressPersistence`
 * with `isAssignmentFlow: false` (simulating the wiped-sessionStorage state)
 * and asserts the new `assignment_ready_for_submit` flag the hook sends to
 * the backend still comes out true once every required step is done — proof
 * that the new auto-submit signal does NOT depend on the broken flag.
 *
 * Same mocking pattern as useStepProgressPersistence.lessonIntroNotRequired.test.ts
 * / .badgeUnlock.test.ts: useProgressSync is mocked so we can inspect exactly
 * what flushProgress/syncProgress were called with.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Stable mock function identities across re-renders (vi.hoisted runs before
// the vi.mock factory below, and before the imports that use them) — a mock
// that minted a fresh vi.fn() on every render would make `.mock.calls` read
// from whichever instance happened to be current, not the one a stale
// closure from an earlier render actually invoked.
const { flushProgressMock, syncProgressMock } = vi.hoisted(() => ({
  flushProgressMock: vi.fn(),
  syncProgressMock: vi.fn(),
}));

vi.mock('./useProgressSync', () => ({
  useProgressSync: () => ({
    syncProgress: syncProgressMock,
    flushProgress: flushProgressMock,
    isProgressLoading: false,
  }),
}));

import { useStepProgressPersistence } from './useStepProgressPersistence';
import { resolveActiveSteps } from '../config/stepConfig';

beforeEach(() => {
  flushProgressMock.mockClear();
  syncProgressMock.mockClear();
});

function setup(isAssignmentFlow: boolean) {
  const setSession = vi.fn();
  const { result } = renderHook(() =>
    useStepProgressPersistence({
      storyId: '99',
      user: { id: 1 } as never,
      token: 'test-token',
      dbSessionId: 1,
      selectedStory: null, // DEFAULT_STEP_SEQUENCE
      isAssignmentFlow,
      setSession,
    }),
  );
  return { result };
}

describe('useStepProgressPersistence — assignment_ready_for_submit (#3695/#3682)', () => {
  it('reports ready=true via flushProgress once every required step is done, even when isAssignmentFlow is FALSE (sessionStorage wiped — the production bug state)', () => {
    const { result } = setup(false);

    // Precondition: hasActiveAssignment mirrors isAssignmentFlow, so this test
    // really is driving the "frontend no longer knows this is an assignment"
    // state the bug happens in.
    expect(result.current.hasActiveAssignment).toBe(false);

    const requiredIds = resolveActiveSteps(undefined)
      .map((s) => s.id)
      .filter((id) => id !== 'lesson-intro' && id !== 'report');

    requiredIds.forEach((stepId, i) => {
      act(() => {
        result.current.saveStepProgressPatch({
          stepId,
          stepData: {},
          markCompleted: true,
          immediate: true,
        });
      });
      const lastCall = flushProgressMock.mock.calls.at(-1)![0];
      const isLastStep = i === requiredIds.length - 1;
      expect(
        lastCall.assignment_ready_for_submit,
        `after completing "${stepId}" (${i + 1}/${requiredIds.length})`,
      ).toBe(isLastStep);
    });
  });

  it('reports ready=false while a required step is still missing', () => {
    const { result } = setup(false);
    const requiredIds = resolveActiveSteps(undefined)
      .map((s) => s.id)
      .filter((id) => id !== 'lesson-intro' && id !== 'report');

    // Complete all but the last required step.
    requiredIds.slice(0, -1).forEach((stepId) => {
      act(() => {
        result.current.saveStepProgressPatch({
          stepId,
          stepData: {},
          markCompleted: true,
          immediate: true,
        });
      });
    });

    const lastCall = flushProgressMock.mock.calls.at(-1)![0];
    expect(lastCall.assignment_ready_for_submit).toBe(false);
  });

  it('behaves identically when isAssignmentFlow is TRUE — the flag is not gated on it either way', () => {
    const { result } = setup(true);
    const requiredIds = resolveActiveSteps(undefined)
      .map((s) => s.id)
      .filter((id) => id !== 'lesson-intro' && id !== 'report');

    requiredIds.forEach((stepId) => {
      act(() => {
        result.current.saveStepProgressPatch({
          stepId,
          stepData: {},
          markCompleted: true,
          immediate: true,
        });
      });
    });

    const lastCall = flushProgressMock.mock.calls.at(-1)![0];
    expect(lastCall.assignment_ready_for_submit).toBe(true);
  });

  it("'report' being marked complete (ReportPage mount) never counts toward readiness by itself", () => {
    const { result } = setup(false);

    act(() => {
      result.current.saveStepProgressPatch({
        stepId: 'report',
        stepData: { viewed_at: '2026-01-01T00:00:00Z' },
        markCompleted: true,
        immediate: true,
      });
    });

    const lastCall = flushProgressMock.mock.calls.at(-1)![0];
    expect(lastCall.steps_completed).toContain('report');
    expect(lastCall.assignment_ready_for_submit).toBe(false);
  });
});

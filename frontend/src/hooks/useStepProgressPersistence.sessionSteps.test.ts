/**
 * #4028 — the page records which steps were completed in THIS session, separately
 * from the cumulative steps_completed that #2889 carries forward.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const flushProgressMock = vi.fn();
const syncProgressMock = vi.fn();
let onProgressLoaded: ((d: unknown) => void) | undefined;

vi.mock('./useProgressSync', () => ({
  useProgressSync: (opts: { onProgressLoaded?: (d: unknown) => void }) => {
    onProgressLoaded = opts.onProgressLoaded;
    return { syncProgress: syncProgressMock, flushProgress: flushProgressMock, isProgressLoading: false };
  },
}));

import { useStepProgressPersistence } from './useStepProgressPersistence';

function setup(initialSessionId = 1) {
  return renderHook(
    ({ dbSessionId }) =>
      useStepProgressPersistence({
        storyId: '99',
        user: { id: 1 } as never,
        token: 'test-token',
        dbSessionId,
        selectedStory: null,
        isAssignmentFlow: false,
        setSession: vi.fn(),
      }),
    { initialProps: { dbSessionId: initialSessionId } },
  );
}

describe('useStepProgressPersistence — session_steps_completed (#4028)', () => {
  beforeEach(() => {
    localStorage.clear();
    flushProgressMock.mockReset();
    syncProgressMock.mockReset();
  });

  it('a completed step goes into both lists and is sent to the server', () => {
    const { result } = setup();
    act(() => {
      result.current.saveStepProgressPatch({ stepId: 'spotlight', stepData: { allDone: true }, markCompleted: true, immediate: true });
    });
    expect(result.current.stepProgressState.steps_completed).toContain('spotlight');
    expect(result.current.stepProgressState.session_steps_completed).toEqual(['spotlight']);
    expect(flushProgressMock.mock.calls.at(-1)?.[0]).toMatchObject({ session_steps_completed: ['spotlight'] });
  });

  it('a mid-step save does not count as completed this session', () => {
    const { result } = setup();
    act(() => {
      result.current.saveStepProgressPatch({ stepId: 'comprehension', stepData: { answers: { q1: 'a' } } });
    });
    expect(result.current.stepProgressState.session_steps_completed).toEqual([]);
  });

  it('redoing a carried step records it as done this session', () => {
    const { result } = setup();
    act(() => {
      onProgressLoaded?.({
        current_step: null,
        steps_completed: ['comprehension'],
        session_steps_completed: [],
        step_data: {},
        __meta: { carried_from: { session_id: 5, steps_completed: ['comprehension'] } },
      });
    });
    act(() => {
      result.current.saveStepProgressPatch({ stepId: 'comprehension', stepData: {}, markCompleted: true });
    });
    expect(result.current.stepProgressState.session_steps_completed).toEqual(['comprehension']);
  });

  it('moving to another DB session does not carry this-session completions along', () => {
    const { result, rerender } = setup(1);
    act(() => {
      result.current.saveStepProgressPatch({ stepId: 'spotlight', stepData: {}, markCompleted: true });
    });
    expect(result.current.stepProgressState.session_steps_completed).toEqual(['spotlight']);
    rerender({ dbSessionId: 2 });
    expect(result.current.stepProgressState.session_steps_completed).toEqual([]);
    // the cumulative list is untouched — that is #2889's job, not this one
    expect(result.current.stepProgressState.steps_completed).toContain('spotlight');
  });

  it('「再讀一次」 takes the step out of this session too', () => {
    const { result } = setup();
    act(() => {
      result.current.saveStepProgressPatch({ stepId: 'paragraph-reading', stepData: {}, markCompleted: true });
    });
    act(() => {
      result.current.resetTutorStep();
    });
    expect(result.current.stepProgressState.session_steps_completed).not.toContain('paragraph-reading');
  });
});

/**
 * Regression test for #2532 review 必改 1 (the resurrection bug):
 * 「再讀一次」must clear EVERY tutor completion / 成績 source so navigating away+back
 * or a full reload can't restore the old reading. The actual clearing lives in
 * useStepProgressPersistence.resetTutorStep (invoked via ParagraphReading's onResetTutor).
 *
 * RED before the fix: resetForRetry() only cleared React state + liveTutor_progress_
 * localStorage, leaving step_data.tutor (incl. readingAttempt), steps_completed 'paragraph-reading',
 * session.readingAttempt, and completedParagraphsSet intact → old 成績 resurrected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { LearningSession } from '../types';

const flushProgressMock = vi.fn();

// useProgressSync does the DB fetch/debounce on mount — stub it so the hook mounts
// without network and its sync/flush are no-ops.
vi.mock('./useProgressSync', () => ({
  useProgressSync: () => ({
    syncProgress: vi.fn(),
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
  return { result, setSession };
}

describe('useStepProgressPersistence.resetTutorStep (#2532 必改 1)', () => {
  beforeEach(() => {
    localStorage.clear();
    flushProgressMock.mockReset();
  });

  it('clears step_data.tutor (incl. readingAttempt), steps_completed, completedParagraphsSet and session', () => {
    const { result, setSession } = setup();

    // Simulate a completed tutor reading (what would otherwise resurrect).
    act(() => {
      result.current.saveStepProgressPatch({
        stepId: 'paragraph-reading',
        stepData: {
          line_results: [{ lineIndex: 0, matchRate: 0.98 }],
          completed_paragraphs: [0],
          paragraph_summaries_data: { 0: { matchRate: 0.98 } },
          readingAttempt: { accuracy: 0.98, cpm: 120 },
        },
        markCompleted: true,
      });
      result.current.setCompletedParagraphsSet(new Set([0]));
    });

    expect(result.current.stepProgressState.steps_completed).toContain('paragraph-reading');
    expect(result.current.completedParagraphsSet.size).toBe(1);

    act(() => {
      result.current.resetTutorStep();
    });

    // 1. step_data.tutor fully cleared, readingAttempt dropped
    const tutor = result.current.stepProgressState.step_data.tutor as Record<string, unknown>;
    expect(tutor.line_results).toEqual([]);
    expect(tutor.completed_paragraphs).toEqual([]);
    expect(tutor.paragraph_summaries_data).toEqual({});
    expect(tutor.readingAttempt).toBeUndefined();

    // 2. 'paragraph-reading' removed from steps_completed
    expect(result.current.stepProgressState.steps_completed).not.toContain('paragraph-reading');

    // 3. in-memory completedParagraphsSet cleared
    expect(result.current.completedParagraphsSet.size).toBe(0);

    // 4. session cleared via the setSession updater
    const updater = setSession.mock.calls.at(-1)![0] as (s: LearningSession) => LearningSession;
    const cleared = updater({
      readingAttempt: { accuracy: 0.98 },
      completedParagraphs: [0],
      completedSteps: ['paragraph-reading', 'character-practice'],
    } as unknown as LearningSession);
    expect(cleared.readingAttempt).toBeNull();
    expect(cleared.completedParagraphs).toEqual([]);
    expect(cleared.completedSteps).toEqual(['character-practice']);
  });

  it('tells the server this is a DELIBERATE un-complete via reset_steps, not just an omission (team-lead review risk)', () => {
    // Why this matters: the server's #3682 fix made steps_completed a
    // monotonic union — a plain save that simply OMITS 'paragraph-reading'
    // would get it silently re-added from the stored data (indistinguishable
    // from the premature-empty-save race the union exists to guard against).
    // resetTutorStep must name it explicitly so the server knows to actually
    // drop it instead of re-union-ing it back in.
    const { result } = setup();

    act(() => {
      result.current.saveStepProgressPatch({
        stepId: 'paragraph-reading',
        stepData: { readingAttempt: { accuracy: 0.98, cpm: 120 } },
        markCompleted: true,
        immediate: true,
      });
    });
    flushProgressMock.mockClear();

    act(() => {
      result.current.resetTutorStep();
    });

    expect(flushProgressMock).toHaveBeenCalledTimes(1);
    const sent = flushProgressMock.mock.calls[0][0];
    expect(sent.reset_steps).toEqual(['paragraph-reading']);
    // And the plain-save fields keep their existing (already-tested-above)
    // shape — this test only locks the NEW reset_steps field, not a redesign.
    expect(sent.steps_completed).not.toContain('paragraph-reading');
  });
});

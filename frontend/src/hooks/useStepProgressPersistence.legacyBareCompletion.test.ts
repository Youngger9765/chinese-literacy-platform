/**
 * TDD regression test for #3682 fix C (part 3) wired into
 * useStepProgressPersistence's missingAssignmentSteps / isAssignmentReadyForSubmit.
 *
 * Reproduces the EXACT production session from scratchpad/teacher-audit/
 * recheck-prod.log case (c):
 *   伺服器 done 8/9，缺 [comprehension]
 *   作業狀態（學生端 API）=in_progress
 *   老師頁：已完成: 0
 *
 * i.e. a real student who answered every real step of a multi-passage
 * lesson, but whose `comprehension` completion was saved BARE (pre-fix bug)
 * while the lesson's resolved step sequence requires the composite
 * `comprehension#pjhxh` — so isAssignmentReadyForSubmit was permanently
 * false even though the student genuinely finished.
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
import type { Story } from '../types';

// A lesson with exactly ONE passage round (`pjhxh`) — every active step has
// that same round suffix, so there is no ambiguity about which round a
// legacy bare completion entry belongs to.
const SINGLE_ROUND_STORY = {
  stepSequence: [
    'full-text-annotate#pjhxh',
    'key-passage-reading#pjhxh',
    'vocab-definition#pjhxh',
    'vocab-application#pjhxh',
    'comprehension#pjhxh',
  ],
} as unknown as Story;

function setup(selectedStory: Story | null) {
  const setSession = vi.fn();
  const { result } = renderHook(() =>
    useStepProgressPersistence({
      storyId: '20017',
      user: { id: 1 } as never,
      token: 'test-token',
      dbSessionId: 1,
      selectedStory,
      isAssignmentFlow: true,
      setSession,
    }),
  );
  return { result };
}

describe('useStepProgressPersistence — legacy bare completion self-heals against a composite requirement (#3682 fix C part 3)', () => {
  it('a student whose comprehension step was saved bare (pre-fix) IS ready to submit once every other required step is the correctly-keyed composite', () => {
    const { result } = setup(SINGLE_ROUND_STORY);

    act(() => {
      capturedOnProgressLoaded!({
        current_step: 'comprehension', // also pre-fix bare, per the audit log
        steps_completed: [
          'full-text-annotate#pjhxh',
          'key-passage-reading#pjhxh',
          'vocab-definition#pjhxh',
          'vocab-application#pjhxh',
          'comprehension', // ← legacy bare entry, exactly like the audited session
        ],
        step_data: {},
      });
    });

    const missingIds = result.current.missingAssignmentSteps.map((s) => s.id);
    expect(missingIds).toEqual([]);
    expect(result.current.isAssignmentReadyForSubmit).toBe(true);
  });

  it('does NOT false-positive a genuinely multi-round lesson from one ambiguous legacy bare entry', () => {
    const multiRoundStory = {
      stepSequence: [
        'comprehension#round1',
        'comprehension#round2',
      ],
    } as unknown as Story;
    const { result } = setup(multiRoundStory);

    act(() => {
      capturedOnProgressLoaded!({
        current_step: 'comprehension',
        // Only a bare entry — ambiguous which round it was for. Must NOT
        // satisfy EITHER round#'s requirement.
        steps_completed: ['comprehension'],
        step_data: {},
      });
    });

    const missingIds = result.current.missingAssignmentSteps.map((s) => s.id);
    expect(missingIds).toEqual(['comprehension#round1', 'comprehension#round2']);
    expect(result.current.isAssignmentReadyForSubmit).toBe(false);
  });
});

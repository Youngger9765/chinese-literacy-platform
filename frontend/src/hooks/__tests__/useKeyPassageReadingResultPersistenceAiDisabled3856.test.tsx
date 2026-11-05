/**
 * #3856 — `aiDisabled` must survive rehydration from the DB-provided
 * `initialResult` prop, not just the in-session React state.
 *
 * Without this, reopening a "重點朗讀" step that was completed while the AI
 * kill switch (#3838) was off would show a fabricated 0% score / low-star
 * card on reload instead of the honest "AI grading was off" notice it was
 * actually completed with — because `getInitialResult()` used to list
 * fields explicitly and silently dropped anything not in that list.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyPassageReadingResultPersistence } from '../useKeyPassageReadingResultPersistence';

describe('#3856 useKeyPassageReadingResultPersistence rehydrates aiDisabled', () => {
  it('carries aiDisabled=true from the DB initialResult prop into result state', () => {
    const { result } = renderHook(() =>
      useKeyPassageReadingResultPersistence({
        storyId: 20017,
        token: null, // skip history fetches — irrelevant to this assertion
        userId: undefined,
        storageKey: `test-aiDisabled-${Math.random()}`, // isolate from other tests' localStorage
        initialResult: {
          matchRate: 0,
          feedback: '',
          cpm: 0,
          durationMs: 30000,
          errorBreakdown: { correct: 0, wrong: 0, missing: 0, extra: 0 },
          aiDisabled: true,
        },
      }),
    );

    expect(result.current.result?.aiDisabled).toBe(true);
  });

  it('a normal (AI-graded) initialResult does not get aiDisabled fabricated onto it', () => {
    const { result } = renderHook(() =>
      useKeyPassageReadingResultPersistence({
        storyId: 20017,
        token: null,
        userId: undefined,
        storageKey: `test-aiEnabled-${Math.random()}`,
        initialResult: {
          matchRate: 0.92,
          feedback: '太厲害了！',
          cpm: 180,
          durationMs: 30000,
          errorBreakdown: { correct: 10, wrong: 0, missing: 0, extra: 0 },
        },
      }),
    );

    expect(result.current.result?.aiDisabled).toBeFalsy();
    expect(result.current.result?.matchRate).toBe(0.92);
  });
});

/**
 * KeyPassageReadingPage — step-aware step id (#2588)
 *
 * The page used to hardcode 'key-passage-reading' in three places (patch stepId,
 * currentStep, and the step_data read key).  It now derives the id from the
 * route.  These tests pin the two properties that matter:
 *
 *   1. Assignment safety — at the real route `/learn/:storyId/key-passage-reading`
 *      the persisted id is STILL exactly 'key-passage-reading'.  A different value
 *      would land in an unknown key: the backend maps frontend step keys to
 *      step numbers (`_FRONTEND_STEP_ALIAS` in backend/app/models/session.py)
 *      and drops unknown ones, so completion stops counting and the assignment
 *      can never be submitted — silently, with no error.
 *   2. No drift — the key written and the key read back are always the same,
 *      and both follow the route when the step is mounted under another id.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../layouts/LearningLayout', () => ({
  useLearningContext: vi.fn(),
}));

// Capture what the page hands down instead of mounting the real recorder UI.
const capturedProps: Record<string, unknown> = {};
vi.mock('../../../components/reading-steps/KeyPassageReading', () => ({
  default: (props: Record<string, unknown>) => {
    Object.assign(capturedProps, props);
    return (
      <button
        data-testid="emit-progress"
        onClick={() =>
          (props.onProgressChange as (d: unknown, i?: boolean) => void)({ cpm: 120 }, true)
        }
      >
        full-reading
      </button>
    );
  },
}));

import { useLearningContext } from '../../../layouts/LearningLayout';
import KeyPassageReadingPage from '../KeyPassageReadingPage';
import type { Story } from '../../../types';

/**
 * Frontend step keys the backend can resolve to a step number — mirrors
 * `_FRONTEND_STEP_ALIAS` + `_STEP_NAMES` in backend/app/models/session.py.
 * Keep in sync when adding steps that persist progress.
 */
const BACKEND_KNOWN_STEP_KEYS = ['key-passage-reading', 'paragraph-reading', 'full-text-annotate'];

const story: Story = {
  id: '1',
  title: '戴資穎',
  level: '4',
  content: ['段落一', '段落二'],
  thumbnail: '/t.jpg',
  category: 'Nonfiction',
  filename: 'G4-L01.yml',
  vocabulary: [],
};

const mockSaveStepProgressPatch = vi.fn();

const makeContext = (stepData: Record<string, unknown> = {}) => ({
  selectedStory: story,
  handleFinishKeyPassageReading: vi.fn(),
  session: null,
  stepProgressData: { current_step: null, steps_completed: [], step_data: stepData },
  saveStepProgressPatch: mockSaveStepProgressPatch,
  dbSessionId: 123,
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/learn/:storyId/:stepId" element={<KeyPassageReadingPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(capturedProps)) delete capturedProps[k];
  (useLearningContext as ReturnType<typeof vi.fn>).mockReturnValue(makeContext());
});

describe('KeyPassageReadingPage — assignment-safety (progress key must stay full-reading)', () => {
  it("persists stepId 'key-passage-reading' at the real route", () => {
    renderAt('/learn/1/key-passage-reading');
    fireEvent.click(screen.getByTestId('emit-progress'));

    expect(mockSaveStepProgressPatch).toHaveBeenCalledWith({
      stepId: 'key-passage-reading',
      stepData: { cpm: 120 },
      currentStep: 'key-passage-reading',
      immediate: true,
    });
  });

  it('persists a step id the backend can resolve to a step number', () => {
    renderAt('/learn/1/key-passage-reading');
    fireEvent.click(screen.getByTestId('emit-progress'));

    const { stepId } = mockSaveStepProgressPatch.mock.calls[0][0];
    expect(BACKEND_KNOWN_STEP_KEYS).toContain(stepId);
  });

  it("reads initialProgress back from step_data['key-passage-reading']", () => {
    (useLearningContext as ReturnType<typeof vi.fn>).mockReturnValue(
      makeContext({ 'key-passage-reading': { cpm: 99 }, tutor: { cpm: 1 } }),
    );
    renderAt('/learn/1/key-passage-reading');

    expect(capturedProps.initialProgress).toEqual({ cpm: 99 });
  });
});

describe('KeyPassageReadingPage — step-aware (no hardcoded id drift)', () => {
  it('follows the route when mounted under another registered step id', () => {
    (useLearningContext as ReturnType<typeof vi.fn>).mockReturnValue(
      // 這一步的進度 key 已從舊別名 `tutor` 改成正式 id `paragraph-reading`。
      // 這條要鎖的是「寫入與讀取用同一個 key」，所以 fixture 也用正式 id ——
      // 留著舊別名的話，讀不到會被誤讀成 key 分岔。
      makeContext({ 'key-passage-reading': { cpm: 99 }, 'paragraph-reading': { cpm: 42 } }),
    );
    renderAt('/learn/1/paragraph-reading');
    fireEvent.click(screen.getByTestId('emit-progress'));

    // write key follows the route…
    expect(mockSaveStepProgressPatch).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'paragraph-reading', currentStep: 'paragraph-reading' }),
    );
    // …and the read key matches it (no split between write and read).
    expect(capturedProps.initialProgress).toEqual({ cpm: 42 });
  });

  it('falls back to the canonical id on an unregistered route segment', () => {
    (useLearningContext as ReturnType<typeof vi.fn>).mockReturnValue(
      makeContext({ 'key-passage-reading': { cpm: 7 } }),
    );
    renderAt('/learn/1/not-a-registered-step');
    fireEvent.click(screen.getByTestId('emit-progress'));

    expect(mockSaveStepProgressPatch).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'key-passage-reading' }),
    );
    expect(capturedProps.initialProgress).toEqual({ cpm: 7 });
  });
});

/**
 * TDD tests for CorrectAnswerBurst wired into ExerciseBlockView's single-choice
 * multiple_choice branch (Issue 3024).
 *
 * Root-cause context: MultipleChoiceExercise.tsx (used by the LEGACY
 * ComprehensionMcqPage fallback path) already got CorrectAnswerBurst wired in.
 * But LESSON_RENDERER_V1 defaults ON in production, and ComprehensionMcqPage
 * prefers the block-based LessonRenderer -> ExerciseBlockView path whenever a
 * story has real v3 lesson_content with a multiple_choice exercise block --
 * which is the common case. Without this second wiring, the correct-answer
 * burst would never reach the actual comprehension MCQ students see on most
 * lessons. Verified live on the PR preview against a real v3 story before
 * writing this test: the legacy path's burst never appeared because the page
 * was rendering ExerciseBlockView, not MultipleChoiceExercise.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: null, user: null }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../services/learningApi', () => ({
  recordMcqAttempt: vi.fn(),
}));

import ExerciseBlockView from '../ExerciseBlockView';

const EXERCISE = {
  id: 'q1',
  kind: 'exercise' as const,
  type: 'exercise' as const,
  answerSpace: 'choice' as const,
  grader: 'exact' as const,
  answer: 1,
  question: {
    kind: 'multiple_choice' as const,
    question: '下列哪個詞語使用正確？',
    options: ['快樂的連假總是「轉瞬即逝」', '他「經年累月」地看了一眼', '天氣「事與願違」'],
  },
};

function renderBlock() {
  return render(
    <ExerciseBlockView
      exercise={EXERCISE as never}
      lessonCode="L0001"
      value={null}
      verdict={null}
      onValueChange={() => {}}
      onGraded={() => {}}
    />,
  );
}

describe('ExerciseBlockView — CorrectAnswerBurst on multiple_choice (Issue 3024)', () => {
  it('shows the burst immediately when the correct option is picked', () => {
    renderBlock();
    // options[1] = the correct answer (exercise.answer === 1)
    fireEvent.click(screen.getAllByText(/他「經年累月」地看了一眼/)[0]);
    expect(screen.getByTestId('correct-answer-burst')).toBeTruthy();
  });

  it('does NOT show the burst when a wrong option is picked', () => {
    renderBlock();
    fireEvent.click(screen.getAllByText(/快樂的連假總是/)[0]);
    expect(screen.queryByTestId('correct-answer-burst')).toBeNull();
  });

  it('still calls recordMcqAttempt telemetry and does not alter existing grading behavior', () => {
    const onGraded = vi.fn();
    render(
      <ExerciseBlockView
        exercise={EXERCISE as never}
        lessonCode="L0001"
        value={null}
        verdict={null}
        onValueChange={() => {}}
        onGraded={onGraded}
      />,
    );
    fireEvent.click(screen.getAllByText(/他「經年累月」地看了一眼/)[0]);
    expect(onGraded).toHaveBeenCalledWith({ verdict: true, needsReview: false });
  });
});

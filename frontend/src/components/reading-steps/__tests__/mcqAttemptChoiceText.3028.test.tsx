/**
 * Issue #3028 — choice_text telemetry across the four MCQ writer components.
 *
 * session_id / attempt_no are resolved server-side (see backend
 * tests/test_mcq_attempt_3028.py); the only new client-side job is sending
 * the option's literal text alongside the existing letter choice, so the
 * teacher-facing "what did students who got this wrong actually pick" view
 * has something more than "12 people picked B" to show.
 *
 * MultipleChoiceExercise's own choice_text coverage lives in
 * MultipleChoiceExercise.test.tsx (it already had a payload-shape test to
 * extend). This file covers the other three writers, which had no
 * dedicated test files before this issue.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GuidedStepsExercise from '../GuidedStepsExercise';
import TraitInferenceExercise from '../TraitInferenceExercise';
import ExerciseBlockView from '../../lesson-content/ExerciseBlockView';
import { StrategyExercise } from '../../../types';
import { recordMcqAttempt } from '../../../services/learningApi';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));
vi.mock('../../../services/learningApi', () => ({
  recordMcqAttempt: vi.fn(),
  validateStrategyAnswer: vi.fn(),
  mcqRescueStart: vi.fn(),
  mcqRescueRespond: vi.fn(),
  SessionExpiredError: class SessionExpiredError extends Error {},
}));

beforeEach(() => {
  vi.mocked(recordMcqAttempt).mockClear();
});

describe('GuidedStepsExercise sends choice_text (#3028)', () => {
  const exercise: StrategyExercise = {
    type: 'guided_steps',
    strategy_name: '引導策略',
    instruction: '依序完成每一步',
    steps: [
      { prompt: '下列何者正確？', type: 'select', options: ['蘋果', '香蕉', '橘子'], answer: 1 },
    ],
  };

  it('submits the picked option text as choice_text', () => {
    render(<GuidedStepsExercise exercise={exercise} lessonId="g7-l1" />);

    fireEvent.click(screen.getByText('蘋果').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    expect(recordMcqAttempt).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({
        lesson_id: 'g7-l1',
        choice: 'A',
        choice_text: '蘋果',
        is_correct: false,
      }),
    );
  });
});

describe('TraitInferenceExercise sends choice_text (#3028)', () => {
  const exercise: StrategyExercise = {
    type: 'trait_inference',
    strategy_name: '人物特質推論',
    instruction: '根據線索推論',
    character: '小明',
    clues: [{ source: '第1段', text: '小明每天都幫助同學' }],
    trait_options: ['善良', '自私', '懶惰', '勇敢'],
    correct_trait: '善良',
  };

  it('submits the selected trait text as choice_text (selected IS the literal text)', () => {
    render(<TraitInferenceExercise exercise={exercise} lessonId="g7-l2" />);

    fireEvent.click(screen.getByText('善良').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: '送出答案' }));

    expect(recordMcqAttempt).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({
        lesson_id: 'g7-l2',
        choice: 'A',
        choice_text: '善良',
        is_correct: true,
      }),
    );
  });
});

describe('ExerciseBlockView (multiple_choice/choice) sends choice_text (#3028)', () => {
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
      options: ['選項甲錯誤用法', '選項乙正確用法', '選項丙錯誤用法'],
    },
  };

  it('submits the clicked option text as choice_text', () => {
    render(
      <ExerciseBlockView
        exercise={EXERCISE as never}
        lessonCode="L0001"
        value={null}
        verdict={null}
        onValueChange={() => {}}
        onGraded={() => {}}
      />,
    );

    fireEvent.click(screen.getAllByText(/選項乙正確用法/)[0]);

    expect(recordMcqAttempt).toHaveBeenCalledWith(
      'test-token',
      expect.objectContaining({
        lesson_id: 'L0001',
        question_id: 'q1',
        choice: 'B',
        choice_text: '選項乙正確用法',
        is_correct: true,
      }),
    );
  });
});

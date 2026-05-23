/**
 * strategyExerciseLogic.ts — shared pure logic for StrategyExercise sub-components.
 *
 * Extracted from StrategyExercise.tsx (#1884) to make unit-testable and
 * keep the component files UI-only.
 */

import { StrategyExercise as StrategyExerciseType } from '../../types';
import { McqRescueContext } from '../reading-spotlight/McqRescueDialog';

export const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

// ── Rescue context builders ────────────────────────────────────────────────

/** Build rescue context for a trait_inference wrong answer. */
export function buildTraitRescueContext(
  exercise: StrategyExerciseType,
  selected: string,
  questionId: string,
  lessonId: string,
  readingStrategy: string | null | undefined,
): McqRescueContext {
  const traitOptions = exercise.trait_options ?? [];
  const correct = exercise.correct_trait ?? '';
  const wrongIdx = traitOptions.indexOf(selected);
  const correctIdx = traitOptions.indexOf(correct);
  const labels = OPTION_LABELS.slice(0, traitOptions.length);

  return {
    questionId,
    lessonId,
    wrongChoice: wrongIdx >= 0 ? labels[wrongIdx] : selected,
    wrongChoiceText: selected,
    questionText: `根據線索推論${exercise.character ?? '主角'}的人物特質`,
    correctAnswer: correctIdx >= 0 ? labels[correctIdx] : correct,
    correctAnswerText: correct,
    options: traitOptions,
    optionLabels: labels,
    strategyType: readingStrategy ?? null,
  };
}

/** Build rescue context for a guided_steps select-type step wrong answer. */
export function buildGuidedStepRescueContext(
  exercise: StrategyExerciseType,
  stepIdx: number,
  wrongAnswerIdx: number,
  lessonId: string,
  readingStrategy: string | null | undefined,
): McqRescueContext {
  const step = (exercise.steps ?? [])[stepIdx];
  const opts = step.options ?? [];
  const labels = OPTION_LABELS.slice(0, opts.length);
  const correctIdx = step.answer ?? 0;

  return {
    questionId: `${lessonId}-spotlight-guided-${stepIdx}`,
    lessonId,
    wrongChoice: wrongAnswerIdx >= 0 ? labels[wrongAnswerIdx] : '',
    wrongChoiceText: wrongAnswerIdx >= 0 ? opts[wrongAnswerIdx] : undefined,
    questionText: step.prompt ?? '',
    correctAnswer: labels[correctIdx] ?? '',
    correctAnswerText: opts[correctIdx],
    options: opts,
    optionLabels: labels,
    strategyType: readingStrategy ?? null,
  };
}

// ── Completion helpers ─────────────────────────────────────────────────────

/**
 * Return true when all feedback entries are non-null (every step submitted).
 * Works for both free_text (always true) and select (true/false).
 */
export function isAllStepsDone(feedback: (boolean | null)[]): boolean {
  return feedback.every((f) => f !== null);
}

/**
 * Compute the next feedback array after submitting step `stepIdx`.
 * Pure — does not mutate input array.
 */
export function computeNextFeedback(
  exercise: StrategyExerciseType,
  prevFeedback: (boolean | null)[],
  answers: (string | number | null)[],
  stepIdx: number,
): (boolean | null)[] {
  const step = (exercise.steps ?? [])[stepIdx];
  const newFeedback = [...prevFeedback];
  if (step.type === 'free_text') {
    newFeedback[stepIdx] = true;
  } else {
    newFeedback[stepIdx] = answers[stepIdx] === (step.answer ?? 0);
  }
  return newFeedback;
}

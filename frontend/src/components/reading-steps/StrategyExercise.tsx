/**
 * StrategyExercise — 閱讀策略練習 (#943) / 閱讀聚光燈 — thin orchestrator.
 *
 * Renders one of three exercise types based on `exercise.type`:
 *   - ordering       → OrderingExercise
 *   - trait_inference → TraitInferenceExercise
 *   - guided_steps   → GuidedStepsExercise
 *
 * Refactored in #1884: each sub-component lives in its own file.
 * Shared logic (rescue context builders, completion helpers) in strategyExerciseLogic.ts.
 */
import React, { useCallback } from 'react';
import { StrategyExercise as StrategyExerciseType } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import OrderingExercise from './OrderingExercise';
import TraitInferenceExercise from './TraitInferenceExercise';
import GuidedStepsExercise from './GuidedStepsExercise';

interface Props {
  exercise: StrategyExerciseType;
  onComplete?: () => void;
  /** Lesson/story ID — passed through to rescue agent for session keying. */
  lessonId?: string;
  /** Reading strategy type — selects strategy-specific rescue prompt. */
  readingStrategy?: string | null;
  /** Persist answer state to parent (Issue #1505 — survive page refresh). */
  onChange?: (exerciseState: Record<string, unknown>) => void;
  initialState?: Record<string, unknown>;
}

const StrategyExercise: React.FC<Props> = ({
  exercise,
  onComplete,
  lessonId,
  readingStrategy,
  onChange,
  initialState,
}) => {
  const { zhuyinActive } = useZhuyin();
  const zhuyinFont = fontForZhuyin(zhuyinActive);

  const handleComplete = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  const content = (() => {
    if (exercise.type === 'ordering')
      return <OrderingExercise exercise={exercise} onComplete={handleComplete} />;
    if (exercise.type === 'trait_inference')
      return (
        <TraitInferenceExercise
          exercise={exercise}
          onComplete={handleComplete}
          lessonId={lessonId}
          readingStrategy={readingStrategy}
        />
      );
    if (exercise.type === 'guided_steps')
      return (
        <GuidedStepsExercise
          exercise={exercise}
          onComplete={handleComplete}
          lessonId={lessonId}
          readingStrategy={readingStrategy}
          onChange={onChange}
          initialState={initialState}
        />
      );
    return (
      <div className="p-4 text-on-surface-variant text-sm text-center">
        不支援的練習類型：{exercise.type}
      </div>
    );
  })();

  return <div style={{ fontFamily: zhuyinFont }}>{content}</div>;
};

export default StrategyExercise;

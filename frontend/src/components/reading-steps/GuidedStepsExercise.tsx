/**
 * GuidedStepsExercise — multi-step exercise with free_text and select steps.
 * Supports MCQ rescue on wrong select answers. Persists state via onChange/initialState.
 * Extracted from StrategyExercise.tsx (#1884).
 */
import React, { useEffect, useState } from 'react';
import { StrategyExercise as StrategyExerciseType } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { recordMcqAttempt } from '../../services/learningApi';
import McqRescueDialog, { McqRescueContext } from '../reading-spotlight/McqRescueDialog';
import StrategyHeader from './StrategyHeader';
import {
  OPTION_LABELS,
  buildGuidedStepRescueContext,
  computeNextFeedback,
  isAllStepsDone,
} from './strategyExerciseLogic';

interface Props {
  exercise: StrategyExerciseType;
  onComplete?: () => void;
  lessonId?: string;
  readingStrategy?: string | null;
  onChange?: (exerciseState: Record<string, unknown>) => void;
  initialState?: Record<string, unknown>;
}

const GuidedStepsExercise: React.FC<Props> = ({
  exercise,
  onComplete,
  lessonId,
  readingStrategy,
  onChange,
  initialState,
}) => {
  const { token } = useAuth();
  const steps = exercise.steps ?? [];

  const [answers, setAnswers] = useState<(string | number | null)[]>(
    () => (initialState?.answers as (string | number | null)[]) ?? steps.map(() => null),
  );
  const [stepFeedback, setStepFeedback] = useState<(boolean | null)[]>(
    () => (initialState?.stepFeedback as (boolean | null)[]) ?? steps.map(() => null),
  );
  const [allDone, setAllDone] = useState(() => !!(initialState?.allDone as boolean));

  // Track which step's rescue is open (null = none).
  const [rescueStepIdx, setRescueStepIdx] = useState<number | null>(null);
  const [rescueContext, setRescueContext] = useState<McqRescueContext | null>(null);

  useEffect(() => {
    onChange?.({ answers, stepFeedback, allDone, exerciseType: 'guided_steps' });
  }, [answers, stepFeedback, allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const openRescueForStep = (stepIdx: number) => {
    const step = steps[stepIdx];
    if (!step || step.type !== 'select') return;
    const wrongIdx =
      typeof answers[stepIdx] === 'number' ? (answers[stepIdx] as number) : -1;
    setRescueContext(
      buildGuidedStepRescueContext(
        exercise,
        stepIdx,
        wrongIdx,
        lessonId ?? '',
        readingStrategy,
      ),
    );
    setRescueStepIdx(stepIdx);
  };

  const handleTextChange = (stepIdx: number, value: string) => {
    if (stepFeedback[stepIdx] !== null) return;
    setAnswers((prev) => prev.map((a, i) => (i === stepIdx ? value : a)));
  };

  const handleSelect = (stepIdx: number, optionIdx: number) => {
    if (stepFeedback[stepIdx] !== null) return;
    setAnswers((prev) => prev.map((a, i) => (i === stepIdx ? optionIdx : a)));
  };

  const handleStepSubmit = (stepIdx: number) => {
    const step = steps[stepIdx];
    const answer = answers[stepIdx];

    if (step.type === 'free_text') {
      if (!answer || String(answer).trim() === '') return;
    } else if (step.type === 'select') {
      if (answer === null) return;
      const isCorrect = answer === (step.answer ?? 0);

      // Telemetry (Issue #1507)
      if (token) {
        const labels = OPTION_LABELS.slice(0, (step.options ?? []).length);
        const idx = answer as number;
        recordMcqAttempt(token, {
          lesson_id: lessonId ?? '',
          question_id: `${lessonId ?? ''}-spotlight-guided-${stepIdx}`,
          choice: (labels[idx] ?? String(idx)).slice(0, 8),
          is_correct: isCorrect,
        });
      }
    }

    const nextFeedback = computeNextFeedback(exercise, stepFeedback, answers, stepIdx);
    setStepFeedback(nextFeedback);

    if (isAllStepsDone(nextFeedback)) {
      setAllDone(true);
      onComplete?.();
    }
  };

  const handleReset = () => {
    setAnswers(steps.map(() => null));
    setStepFeedback(steps.map(() => null));
    setAllDone(false);
  };

  return (
    <div>
      <StrategyHeader name={exercise.strategy_name} instruction={exercise.instruction} />

      <div className="space-y-6">
        {steps.map((step, stepIdx) => {
          const feedback = stepFeedback[stepIdx];
          const isDone = feedback !== null;
          return (
            <div
              key={stepIdx}
              className="rounded-xl border border-gray-200 bg-surface-container-low p-4"
            >
              <div className="flex items-start gap-2 mb-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center mt-0.5">
                  {stepIdx + 1}
                </span>
                <p className="text-sm font-medium text-on-surface-variant">{step.prompt}</p>
              </div>

              {step.type === 'free_text' ? (
                <div>
                  <textarea
                    value={String(answers[stepIdx] ?? '')}
                    onChange={(e) => handleTextChange(stepIdx, e.target.value)}
                    disabled={isDone}
                    rows={3}
                    placeholder="請在此寫下你的答案..."
                    className={[
                      'w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors',
                      isDone
                        ? 'bg-gray-50 border-gray-200 text-gray-500'
                        : 'bg-white border-gray-300 focus:border-violet-400 focus:ring-2 focus:ring-violet-100',
                    ].join(' ')}
                  />
                  {isDone && (
                    <p className="mt-2 text-xs text-emerald-600 font-semibold">
                      &#10003; 已記錄你的答案
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {(step.options ?? []).map((option, optIdx) => {
                    const isSelected = answers[stepIdx] === optIdx;
                    const isCorrectOpt = isDone && optIdx === (step.answer ?? 0);
                    const isWrongSelected =
                      isDone && isSelected && optIdx !== (step.answer ?? 0);
                    return (
                      <button
                        key={optIdx}
                        onClick={() => handleSelect(stepIdx, optIdx)}
                        className={[
                          'w-full text-left px-4 py-2.5 rounded-lg border-2 text-sm transition-all',
                          isCorrectOpt
                            ? 'bg-emerald-50 border-emerald-400 text-emerald-700 font-semibold'
                            : isWrongSelected
                            ? 'bg-red-50 border-red-300 text-red-600'
                            : isSelected
                            ? 'bg-violet-50 border-violet-400 text-violet-700'
                            : 'bg-surface-container-low border-gray-200 text-on-surface-variant hover:border-violet-200',
                        ].join(' ')}
                      >
                        <span className="font-semibold mr-2">
                          {String.fromCharCode(65 + optIdx)}.
                        </span>
                        {option}
                        {isCorrectOpt && (
                          <span className="ml-2 text-emerald-500">&#10003;</span>
                        )}
                        {isWrongSelected && (
                          <span className="ml-2 text-red-400">&#10007;</span>
                        )}
                      </button>
                    );
                  })}
                  {isDone && feedback !== null && (
                    <p
                      className={`mt-1 text-xs font-semibold ${
                        feedback ? 'text-emerald-600' : 'text-amber-600'
                      }`}
                    >
                      {feedback ? (
                        <>{'✓'} 答對了！</>
                      ) : (
                        `還不對，正確答案是 ${String.fromCharCode(65 + (step.answer ?? 0))}`
                      )}
                    </p>
                  )}
                  {isDone && feedback === false && rescueStepIdx !== stepIdx && (
                    <button
                      onClick={() => openRescueForStep(stepIdx)}
                      className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors"
                    >
                      <span aria-hidden="true">🦉</span>
                      問 AI 助教，一起想想看
                    </button>
                  )}
                </div>
              )}

              {!isDone && (
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => handleStepSubmit(stepIdx)}
                    disabled={
                      step.type === 'free_text'
                        ? !String(answers[stepIdx] ?? '').trim()
                        : answers[stepIdx] === null
                    }
                    className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold transition-colors"
                  >
                    確認
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allDone && (
        <div className="mt-4 rounded-xl p-4 bg-emerald-50 border border-emerald-200">
          <p className="text-emerald-700 font-semibold text-sm text-center">全部步驟完成！</p>
        </div>
      )}

      {allDone && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleReset}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold text-sm transition-colors"
          >
            重新練習
          </button>
        </div>
      )}

      <McqRescueDialog
        isOpen={rescueStepIdx !== null}
        context={rescueContext}
        onClose={() => setRescueStepIdx(null)}
        onComplete={() => setRescueStepIdx(null)}
      />
    </div>
  );
};

export default GuidedStepsExercise;

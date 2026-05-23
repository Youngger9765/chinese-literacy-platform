/**
 * TraitInferenceExercise — show clues, pick character trait, MCQ rescue on wrong answer.
 * Extracted from StrategyExercise.tsx (#1884).
 */
import React, { useState } from 'react';
import { StrategyExercise as StrategyExerciseType } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { recordMcqAttempt } from '../../services/learningApi';
import McqRescueDialog, { McqRescueContext } from '../reading-spotlight/McqRescueDialog';
import StrategyHeader from './StrategyHeader';
import { OPTION_LABELS, buildTraitRescueContext } from './strategyExerciseLogic';

interface Props {
  exercise: StrategyExerciseType;
  onComplete?: () => void;
  lessonId?: string;
  readingStrategy?: string | null;
}

const TraitInferenceExercise: React.FC<Props> = ({
  exercise,
  onComplete,
  lessonId,
  readingStrategy,
}) => {
  const { token } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [rescueOpen, setRescueOpen] = useState(false);
  const [rescueContext, setRescueContext] = useState<McqRescueContext | null>(null);

  const correct = exercise.correct_trait ?? '';
  const traitOptions = exercise.trait_options ?? [];
  const isWrong = submitted && selected !== null && selected !== correct;
  const questionId = `${lessonId ?? ''}-spotlight-trait`;

  const handleSelect = (trait: string) => {
    if (submitted) return;
    setSelected(trait);
  };

  const handleSubmit = () => {
    if (!selected) return;
    setSubmitted(true);
    const correctAnswer = selected === correct;
    if (correctAnswer) onComplete?.();

    if (token) {
      const labelIdx = traitOptions.indexOf(selected);
      // Defensive slice — backend choice column is VARCHAR(8)
      const choice = (labelIdx >= 0 ? OPTION_LABELS[labelIdx] : selected).slice(0, 8);
      recordMcqAttempt(token, {
        lesson_id: lessonId ?? '',
        question_id: questionId,
        choice,
        is_correct: correctAnswer,
      });
    }
  };

  const handleReset = () => {
    setSelected(null);
    setSubmitted(false);
  };

  const openRescue = () => {
    if (!selected) return;
    setRescueContext(
      buildTraitRescueContext(exercise, selected, questionId, lessonId ?? '', readingStrategy),
    );
    setRescueOpen(true);
  };

  return (
    <div>
      <StrategyHeader name={exercise.strategy_name} instruction={exercise.instruction} />

      <p className="text-sm font-semibold text-gray-700 mb-3">
        根據下列線索，推論{exercise.character}的人物特質：
      </p>

      <div className="space-y-2 mb-5">
        {(exercise.clues ?? []).map((clue, idx) => (
          <div
            key={idx}
            className="flex gap-3 bg-surface-container-low rounded-xl border border-gray-200 px-4 py-3"
          >
            <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 text-xs font-semibold">
              {clue.source}
            </span>
            <span className="text-sm text-on-surface">{clue.text}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500 mb-2">選出最符合的人物特質：</p>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {traitOptions.map((trait) => {
          const isSelected = selected === trait;
          const isCorrectOption = submitted && trait === correct;
          const isWrongSelected = submitted && isSelected && trait !== correct;
          return (
            <button
              key={trait}
              onClick={() => handleSelect(trait)}
              className={[
                'py-3 rounded-xl border-2 text-sm font-semibold transition-all',
                isCorrectOption
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                  : isWrongSelected
                  ? 'bg-red-50 border-red-300 text-red-600'
                  : isSelected
                  ? 'bg-violet-50 border-violet-400 text-violet-700'
                  : 'bg-surface-container-low border-gray-200 text-on-surface-variant hover:border-violet-300 hover:bg-violet-50/30',
              ].join(' ')}
            >
              {trait}
              {isCorrectOption && <span className="ml-1">&#10003;</span>}
              {isWrongSelected && <span className="ml-1">&#10007;</span>}
            </button>
          );
        })}
      </div>

      {submitted && (
        <div
          className={`rounded-xl p-4 mb-4 ${
            selected === correct
              ? 'bg-emerald-50 border border-emerald-200'
              : 'bg-amber-50 border border-amber-200'
          }`}
        >
          {selected === correct ? (
            <p className="text-emerald-700 font-semibold text-sm text-center">
              你答對了！{exercise.character}的特質是「{correct}」
            </p>
          ) : (
            <p className="text-amber-700 font-semibold text-sm text-center">
              還不對喔！正確答案是「{correct}」，可以再看看線索
            </p>
          )}
        </div>
      )}

      {/* AI rescue — opt-in on wrong answer (Issue #1507) */}
      {isWrong && !rescueOpen && (
        <button
          onClick={openRescue}
          className="w-full mb-3 flex items-center justify-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors"
        >
          <span aria-hidden="true">🦉</span>
          問 AI 助教，一起想想看
        </button>
      )}

      <McqRescueDialog
        isOpen={rescueOpen}
        context={rescueContext}
        onClose={() => setRescueOpen(false)}
        onComplete={() => setRescueOpen(false)}
      />

      <div className="flex gap-2">
        {!submitted && (
          <button
            onClick={handleSubmit}
            disabled={!selected}
            className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm transition-colors"
          >
            送出答案
          </button>
        )}
        {submitted && (
          <button
            onClick={handleReset}
            className="flex-1 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold text-sm transition-colors"
          >
            重新練習
          </button>
        )}
      </div>
    </div>
  );
};

export default TraitInferenceExercise;

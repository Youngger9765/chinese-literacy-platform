/**
 * StrategyExercisePage — Step: 閱讀聚光燈 (reading-strategy, dbStep 16)
 *
 * Wraps ComprehensionLayout + StrategyExercise (single-exercise schema) or
 * GraphicTextIntegrationExercise (G7 圖文整合, list schema, #1683).
 *
 * When the lesson has no strategyExercise, shows a friendly placeholder
 * and allows the student to advance with one click.
 * Calls handleFinishReadingStrategy from LearningContext when done.
 */
import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ComprehensionLayout from '../../components/reading-steps/ComprehensionLayout';
import StrategyExercise from '../../components/reading-steps/StrategyExercise';
import GraphicTextIntegrationExercise from '../../components/reading-steps/GraphicTextIntegrationExercise';
import OmoPaperResultBanner from '../../components/reading-steps/OmoPaperResultBanner';
import { useLearningContext } from '../../layouts/LearningLayout';
import type { StrategyExercise as StrategyExerciseType, StrategyExerciseItem } from '../../types';

const StrategyExercisePage: React.FC = () => {
  const navigate = useNavigate();
  const {
    selectedStory,
    handleFinishReadingStrategy,
    dbSessionId,
    saveStepProgressPatch,
    stepProgressData,
  } = useLearningContext();

  const savedStrategyData = stepProgressData.step_data?.['reading-strategy'] as Record<string, unknown> | undefined;

  const [strategyDone, setStrategyDone] = useState(() => !!(savedStrategyData?.allDone));

  const handleProgressChange = useCallback(
    (stepData: Record<string, unknown>, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'reading-strategy',
        stepData,
        currentStep: 'reading-strategy',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  const handleAnswerChange = useCallback(
    (exerciseState: Record<string, unknown>) => {
      handleProgressChange(exerciseState, false);
    },
    [handleProgressChange],
  );

  const handleStrategyComplete = useCallback(() => {
    setStrategyDone(true);
  }, []);

  const handleNext = useCallback(() => {
    handleProgressChange({ completed: true, strategyDone }, true);
    handleFinishReadingStrategy();
  }, [handleFinishReadingStrategy, handleProgressChange, strategyDone]);

  if (!selectedStory) return null;

  const rawExercise = selectedStory.strategyExercise;
  const hasStrategy = !!rawExercise;

  // G7 圖文整合 schema is a list of {exercise, description, steps} items with
  // no `type` field — different from the single-object StrategyExercise schema.
  // Detect via Array.isArray and the absence of `type` on the first element.
  // #1683: render with GraphicTextIntegrationExercise to avoid the
  // "不支援的練習類型" fallthrough in StrategyExercise.
  const isGraphicTextList =
    Array.isArray(rawExercise) &&
    rawExercise.length > 0 &&
    !('type' in (rawExercise[0] as object));

  return (
    <ComprehensionLayout
      story={selectedStory}
      dbSessionId={dbSessionId ?? undefined}
      exerciseIcon="lightbulb"
      exerciseLabel="閱讀聚光燈"
    >
      <OmoPaperResultBanner stepId="reading-strategy" />
      {hasStrategy ? (
        <>
          {isGraphicTextList ? (
            <GraphicTextIntegrationExercise
              exercises={rawExercise as StrategyExerciseItem[]}
              onComplete={handleStrategyComplete}
              onChange={handleAnswerChange}
              initialState={savedStrategyData}
            />
          ) : (
            <StrategyExercise
              exercise={rawExercise as StrategyExerciseType}
              onComplete={handleStrategyComplete}
              lessonId={selectedStory.id}
              readingStrategy={selectedStory.readingStrategy}
              onChange={handleAnswerChange}
              initialState={savedStrategyData}
            />
          )}
          {/* Show "下一關" once the strategy exercise is done (or always allow skip) */}
          <div className="mt-6 shrink-0">
            <button
              onClick={handleNext}
              className={`w-full h-12 rounded-full font-headline font-bold text-base text-white transition-all flex items-center justify-center gap-2 ${
                strategyDone
                  ? 'shadow-[0_8px_32px_rgba(86,74,191,0.25)] hover:brightness-110 active:scale-[0.98]'
                  : 'opacity-60 cursor-not-allowed'
              }`}
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              disabled={!strategyDone}
            >
              <span>下一關</span>
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </button>
            {!strategyDone && (
              <p className="text-center text-xs text-on-surface-variant mt-2">
                完成閱讀聚光燈後才能繼續
              </p>
            )}
          </div>
        </>
      ) : (
        /* Lesson has no strategy exercise — warm reassuring empty-state + CTA */
        <div className="flex flex-col items-center justify-center py-12 gap-5 text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl opacity-30">lightbulb</span>
          <div className="text-center">
            <p className="text-sm font-medium text-on-surface">本課暫無閱讀聚光燈練習 — 老師團隊正在整理中</p>
            <p className="text-xs mt-1 opacity-60">你可以先去其他課文練習，或直接跳到下一個步驟</p>
          </div>
          {/* Primary CTA: navigate to library */}
          <button
            onClick={() => navigate('/library')}
            className="px-8 h-11 rounded-full font-headline font-bold text-sm text-white shadow-[0_8px_32px_rgba(86,74,191,0.25)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
          >
            <span className="material-symbols-outlined text-sm">library_books</span>
            <span>找其他課文練習</span>
          </button>
          {/* Secondary: skip to next step */}
          <button
            onClick={handleNext}
            className="px-6 h-9 rounded-full font-headline text-sm text-on-surface-variant border border-outline-variant hover:bg-surface-variant active:scale-[0.98] transition-all flex items-center gap-1"
          >
            <span>跳過，下一關</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      )}
    </ComprehensionLayout>
  );
};

export default StrategyExercisePage;

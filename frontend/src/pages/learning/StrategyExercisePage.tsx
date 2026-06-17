/**
 * StrategyExercisePage — Step: 閱讀聚光燈 (reading-strategy, dbStep 16)
 *
 * v2 (#2205): BlockSequenceRenderer when spotlightV2.blocks present (dev7).
 * Legacy: StrategyExercise / GraphicTextIntegrationExercise via ComprehensionLayout.
 */
import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ComprehensionLayout from '../../components/reading-steps/ComprehensionLayout';
import StrategyExercise from '../../components/reading-steps/StrategyExercise';
import GraphicTextIntegrationExercise from '../../components/reading-steps/GraphicTextIntegrationExercise';
import BlockSequenceRenderer from '../../components/reading-spotlight/BlockSequenceRenderer';
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

  const spotlightV2 = selectedStory.spotlightV2;
  const hasSpotlightV2 = !!(spotlightV2?.blocks?.length);
  const rawExercise = selectedStory.strategyExercise;
  const hasStrategy = hasSpotlightV2 || !!rawExercise;

  const isGraphicTextList =
    !hasSpotlightV2 &&
    Array.isArray(rawExercise) &&
    rawExercise.length > 0 &&
    !('type' in (rawExercise[0] as object));

  const nextButton = (
    <div className="mt-6 shrink-0 max-w-3xl mx-auto w-full">
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
  );

  if (hasSpotlightV2 && spotlightV2) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-6">
        <OmoPaperResultBanner stepId="reading-strategy" />
        <BlockSequenceRenderer
          spotlight={spotlightV2}
          story={selectedStory}
          lessonId={selectedStory.lesson_code || selectedStory.id}
          onComplete={handleStrategyComplete}
          onChange={handleAnswerChange}
          initialState={savedStrategyData}
          onOpenKeypoints={() => navigate(`/learn/${selectedStory.id}/story-structure`)}
        />
        {nextButton}
      </div>
    );
  }

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
              storyTitle={selectedStory.title}
              passage={selectedStory.content?.join('\n')}
              onChange={handleAnswerChange}
              initialState={savedStrategyData}
            />
          )}
          {nextButton}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 gap-5 text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl opacity-30">lightbulb</span>
          <div className="text-center">
            <p className="text-sm font-medium text-on-surface">本課暫無閱讀聚光燈練習 — 老師團隊正在整理中</p>
            <p className="text-xs mt-1 opacity-60">你可以先去其他課文練習，或直接跳到下一個步驟</p>
          </div>
          <button
            onClick={() => navigate('/library')}
            className="px-8 h-11 rounded-full font-headline font-bold text-sm text-white shadow-[0_8px_32px_rgba(86,74,191,0.25)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
          >
            <span className="material-symbols-outlined text-sm">library_books</span>
            <span>找其他課文練習</span>
          </button>
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

/**
 * StrategyExercisePage — Step: 閱讀聚光燈 (reading-strategy, dbStep 16)
 *
 * Wraps ComprehensionLayout + StrategyExercise.
 * When the lesson has no strategyExercise, shows a friendly placeholder
 * and allows the student to advance with one click.
 * Calls handleFinishReadingStrategy from LearningContext when done.
 */
import React, { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import ComprehensionLayout from '../../components/reading-steps/ComprehensionLayout';
import StrategyExercise from '../../components/reading-steps/StrategyExercise';
import { useLearningContext } from '../../layouts/LearningLayout';

const StrategyExercisePage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishReadingStrategy,
    dbSessionId,
    saveStepProgressPatch,
  } = useLearningContext();

  const [strategyDone, setStrategyDone] = useState(false);

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

  const handleStrategyComplete = useCallback(() => {
    setStrategyDone(true);
  }, []);

  const handleNext = useCallback(() => {
    handleProgressChange({ completed: true, strategyDone }, true);
    handleFinishReadingStrategy();
  }, [handleFinishReadingStrategy, handleProgressChange, strategyDone]);

  if (!selectedStory) return null;

  const hasStrategy = !!selectedStory.strategyExercise;

  return (
    <ComprehensionLayout
      story={selectedStory}
      dbSessionId={dbSessionId ?? undefined}
    >
      {hasStrategy ? (
        <>
          <StrategyExercise
            exercise={selectedStory.strategyExercise!}
            onComplete={handleStrategyComplete}
          />
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
        /* Lesson has no strategy exercise — show placeholder + skip */
        <div className="flex flex-col items-center justify-center py-12 gap-5 text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl opacity-30">lightbulb</span>
          <p className="text-sm font-medium">此課文尚未有閱讀聚光燈練習</p>
          <button
            onClick={handleNext}
            className="px-8 h-11 rounded-full font-headline font-bold text-sm text-white shadow-[0_8px_32px_rgba(86,74,191,0.25)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
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

/**
 * SpotlightPage — Step: 閱讀聚光燈 (reading-strategy, dbStep 16)
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
import { LESSON_RENDERER_V1 } from '../../config/featureFlags';
import LessonRenderer from '../../components/lesson-content/LessonRenderer';
import { storyToLesson } from '../../components/lesson-content/lessonContentAdapter';
import NextStepFooter from '../../components/learning/NextStepFooter';

const SpotlightPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    selectedStory,
    handleFinishReadingStrategy,
    dbSessionId,
    saveStepProgressPatch,
    stepProgressData,
  } = useLearningContext();

  const savedStrategyData = stepProgressData.step_data?.['spotlight'] as Record<string, unknown> | undefined;

  const [strategyDone, setStrategyDone] = useState(() => !!(savedStrategyData?.allDone));

  const handleProgressChange = useCallback(
    (stepData: Record<string, unknown>, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'spotlight',
        stepData,
        currentStep: 'spotlight',
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
    <NextStepFooter
      onNext={handleNext}
      disabled={!strategyDone}
      disabledHint="完成閱讀聚光燈後才能繼續"
    />
  );

  // Phase-2 unified renderer (flag-guarded, default OFF). Placed BEFORE every legacy
  // render branch below; engages only when the adapter yields a valid zod Lesson, else
  // falls through to the byte-identical legacy path (fail-safe, never white-screens).
  if (LESSON_RENDERER_V1) {
    // Prefer the backend-supplied REAL lesson_content (typed contract from the story
    // adapter); fall back to the front-end storyToLesson stopgap when the backend flag is
    // OFF or the payload didn't parse (selectedStory.lessonContent is undefined).
    const lesson = selectedStory.lessonContent ?? storyToLesson(selectedStory).lesson;
    // Only adopt a Lesson here if it actually carries the 閱讀聚光燈 (a reading-strategy
    // exercise: guided_steps / graphic_text_integration). Symmetric with ComprehensionMcqPage's
    // MCQ guard — the two steps partition by content type so neither hijacks the other.
    const lessonHasSpotlight =
      !!lesson &&
      lesson.blocks.some(
        (b) =>
          b.type === 'exercise' &&
          (b.question.kind === 'guided_steps' || b.question.kind === 'graphic_text_integration'),
      );
    if (lesson && lessonHasSpotlight) {
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-4 py-6">
          <OmoPaperResultBanner stepId="spotlight" />
          <LessonRenderer
            sectionLabel="閱讀聚光燈"
            lesson={lesson}
            story={selectedStory}
            lessonCode={selectedStory.lesson_code || selectedStory.id}
            onExerciseChange={(state) => handleAnswerChange({ ...state })}
            onComplete={handleStrategyComplete}
            initialState={savedStrategyData}
          />
          {nextButton}
        </div>
      );
    }
  }

  if (hasSpotlightV2 && spotlightV2) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-6">
        <OmoPaperResultBanner stepId="spotlight" />
        <BlockSequenceRenderer
          spotlight={spotlightV2}
          story={selectedStory}
          lessonId={selectedStory.lesson_code || selectedStory.id}
          onComplete={handleStrategyComplete}
          onChange={handleAnswerChange}
          initialState={savedStrategyData}
          onOpenKeypoints={() => navigate(`/learn/${selectedStory.id}/keypoints-table`)}
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
      <OmoPaperResultBanner stepId="spotlight" />
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
        </div>
      )}
      {/* 這一課沒有聚光燈資料時的出口。用同一個 footer —— 學生在每一步看到的
          「下一關」要是同一顆，不能因為這頁走空狀態就換一種樣子。 */}
      {!hasStrategy && <NextStepFooter onNext={handleNext} label="跳過，下一關" />}
    </ComprehensionLayout>
  );
};

export default SpotlightPage;

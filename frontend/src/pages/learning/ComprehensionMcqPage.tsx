/**
 * ComprehensionMcqPage — Step: 閱讀理解 (comprehension, dbStep 3)
 *
 * Replaces ComprehensionPage / ComprehensionChat for the MCQ-only step.
 * Wraps ComprehensionLayout + MultipleChoiceExercise.
 * When the lesson has no MCQ data, shows a placeholder + skip button.
 * Calls handleFinishComprehension from LearningContext when done.
 */
import React, { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import ComprehensionLayout from '../../components/reading-steps/ComprehensionLayout';
import MultipleChoiceExercise from '../../components/reading-steps/MultipleChoiceExercise';
import OmoPaperResultBanner from '../../components/reading-steps/OmoPaperResultBanner';
import { useLearningContext } from '../../layouts/LearningLayout';
import { ComprehensionResult } from '../../types';
import { LESSON_RENDERER_V1 } from '../../config/featureFlags';
import LessonRenderer from '../../components/lesson-content/LessonRenderer';
import { storyToLesson } from '../../components/lesson-content/lessonContentAdapter';

const ComprehensionMcqPage: React.FC = () => {
  const { storyId } = useParams<{ storyId: string }>();
  const {
    selectedStory,
    handleFinishComprehension,
    dbSessionId,
    saveStepProgressPatch,
  } = useLearningContext();

  const [mcqDone, setMcqDone] = useState(false);
  const [mcqResult, setMcqResult] = useState<{ score: number; total: number } | null>(null);

  const handleProgressChange = useCallback(
    (stepData: Record<string, unknown>, immediate = false) => {
      saveStepProgressPatch({
        stepId: 'comprehension',
        stepData,
        currentStep: 'comprehension',
        immediate,
      });
    },
    [saveStepProgressPatch],
  );

  const handleMcqComplete = useCallback(
    (score: number, total: number) => {
      setMcqDone(true);
      setMcqResult({ score, total });
      handleProgressChange({ mcqScore: score, mcqTotal: total }, false);
    },
    [handleProgressChange],
  );

  const handleNext = useCallback(() => {
    const result: ComprehensionResult = {
      understoodCount: mcqResult?.score ?? 0,
      requiredCount: mcqResult?.total ?? 1,
      isComplete: true,
      conversationLength: 0,
    };
    handleProgressChange(
      { result, mcqScore: mcqResult?.score ?? 0, mcqTotal: mcqResult?.total ?? 0, isWorksheetComplete: true },
      true,
    );
    handleFinishComprehension(result);
  }, [handleFinishComprehension, handleProgressChange, mcqResult]);

  const handleSkip = useCallback(() => {
    const result: ComprehensionResult = {
      understoodCount: 0,
      requiredCount: 1,
      isComplete: true,
      conversationLength: 0,
    };
    handleProgressChange({ result, isWorksheetComplete: true }, true);
    handleFinishComprehension(result);
  }, [handleFinishComprehension, handleProgressChange]);

  if (!selectedStory) return null;

  const hasMcq = !!(selectedStory.multipleChoice && selectedStory.multipleChoice.length > 0);

  // Phase-2 unified renderer (flag-guarded, default OFF). Placed BEFORE the legacy layout;
  // engages only when the adapter yields a valid zod Lesson, else falls through to the
  // byte-identical legacy path (fail-safe, never white-screens).
  if (LESSON_RENDERER_V1) {
    // Prefer the backend-supplied REAL lesson_content (typed contract from the story
    // adapter); fall back to the front-end storyToLesson stopgap when the backend flag is
    // OFF or the payload didn't parse (selectedStory.lessonContent is undefined).
    const lesson = selectedStory.lessonContent ?? storyToLesson(selectedStory).lesson;
    // Only adopt a Lesson here if it actually carries COMPREHENSION content (a
    // multiple_choice exercise). The AI-extracted lessons are 閱讀聚光燈-ONLY (guided_steps /
    // graphic_text_integration) and must NOT hijack the 閱讀理解 step — without this guard the
    // comprehension page would render the spotlight (the reading-strategy content). When the
    // lesson has no MCQ, fall through to the legacy comprehension layout.
    const lessonHasMcq =
      !!lesson &&
      lesson.blocks.some((b) => b.type === 'exercise' && b.question.kind === 'multiple_choice');
    if (lesson && lessonHasMcq) {
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-4 py-6">
          <OmoPaperResultBanner stepId="comprehension" />
          <LessonRenderer
            lesson={lesson}
            story={selectedStory}
            lessonCode={selectedStory.lesson_code || selectedStory.id}
            onComplete={() => {
              const total = selectedStory.multipleChoice?.length ?? 0;
              handleMcqComplete(total, total);
            }}
          />
          {mcqDone ? (
            <div className="mt-6 shrink-0 w-full max-w-3xl mx-auto">
              <button
                onClick={handleNext}
                className="w-full h-12 rounded-full font-headline font-bold text-base text-white shadow-[0_8px_32px_rgba(86,74,191,0.25)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                <span>下一關</span>
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            </div>
          ) : null}
        </div>
      );
    }
  }

  return (
    <ComprehensionLayout
      story={selectedStory}
      dbSessionId={dbSessionId ?? undefined}
      progressPercent={mcqDone ? 100 : hasMcq ? -1 : -1}
      exerciseIcon="quiz"
      exerciseLabel="閱讀理解"
    >
      <OmoPaperResultBanner stepId="comprehension" />
      {hasMcq ? (
        mcqDone ? (
          /* Done state */
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-emerald-600">check_circle</span>
            </div>
            <p className="text-emerald-700 font-headline font-bold">選擇題已完成</p>
            {mcqResult && (
              <p className="text-sm text-on-surface-variant">
                {mcqResult.score === mcqResult.total
                  ? '全部答對，太棒了！'
                  : `答對 ${mcqResult.score} / ${mcqResult.total} 題，繼續加油！`}
              </p>
            )}
            <div className="mt-4 w-full">
              <button
                onClick={handleNext}
                className="w-full h-12 rounded-full font-headline font-bold text-base text-white shadow-[0_8px_32px_rgba(86,74,191,0.25)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                <span>下一關</span>
                <span className="material-symbols-outlined text-base">arrow_forward</span>
              </button>
            </div>
          </div>
        ) : (
          /* MCQ in progress */
          <MultipleChoiceExercise
            questions={selectedStory.multipleChoice!}
            onComplete={handleMcqComplete}
            lessonId={selectedStory.id}
            readingStrategy={selectedStory.readingStrategy}
          />
        )
      ) : (
        /* No MCQ data */
        <div className="flex flex-col items-center justify-center py-12 gap-5 text-on-surface-variant">
          <span className="material-symbols-outlined text-5xl opacity-30">quiz</span>
          <p className="text-sm font-medium">此課文尚未有選擇題</p>
          <button
            onClick={handleSkip}
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

export default ComprehensionMcqPage;

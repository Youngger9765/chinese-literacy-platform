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
import { WrongAnswerReviewList } from '../../components/learning/WrongAnswerReviewList';
import { firstTryScore, type FirstTryRecord } from '../../utils/questionReview';
import { absorbVerdicts, reviewItemsOf, type ReviewableBlock } from './comprehensionReview';
import { normalizeChoiceAnswer } from '../../components/lesson-content/lessonGrading';
import { storyToLesson } from '../../components/lesson-content/lessonContentAdapter';
import NextStepFooter from '../../components/learning/NextStepFooter';

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
  // 第一次作答的對錯。重試不覆蓋 —— 學生一定會重試到對，
  // 拿「當下還錯的」當錯題來源，那個集合到最後恆為空（#2784 就是這樣壞的）。
  const [firstTry, setFirstTry] = useState<FirstTryRecord<string, string>[]>([]);

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

  // `LessonRenderer.onComplete` is a dependency of its own `useEffect(() => { if (allDone)
  // onComplete?.() }, [allDone, onComplete])`. An inline `() => {...}` literal here would be
  // a NEW function reference every render; once `allDone` flips true, `handleMcqComplete`
  // fires `setMcqResult({ score, total })` — a new OBJECT every call, so React never bails
  // out on reference equality — which re-renders this page, recreates the inline callback,
  // and re-fires the effect. Confirmed via isolated repro (#2779 investigation): render
  // count grows unbounded, "Maximum update depth exceeded" logged repeatedly, tab pegged at
  // ~95% CPU. `useCallback` here is load-bearing, not a style nit.
  // ⚠️ 這裡以前是 `handleMcqComplete(total, total)` —— 寫死滿分。
  // 學生錯幾題都記 100%，而那個數字會流進學習紀錄與老師端報表。
  // 現在用第一次作答的真實分數（#2790）。
  const handleLessonRendererComplete = useCallback(() => {
    const { correct, total } = firstTryScore(firstTry);
    const fallback = selectedStory?.multipleChoice?.length ?? 0;
    handleMcqComplete(correct, total || fallback);
  }, [firstTry, selectedStory, handleMcqComplete]);

  // lesson.blocks → 計分/錯題卡片需要的最小形狀。`normalizeChoiceAnswer` 是
  // 這個 repo 判定選擇題正解的單一權威（answer 可能是索引也可能是 'A' 字母）。
  const reviewableBlocksOf = useCallback((lesson: { blocks?: unknown[] } | null | undefined): ReviewableBlock[] => {
    if (!lesson?.blocks) return [];
    return (lesson.blocks as Array<Record<string, any>>)
      .filter((b) => b?.type === 'exercise' && b?.question?.kind === 'multiple_choice')
      .map((b) => ({
        id: String(b.id),
        stem: String(b.question?.prompt ?? b.question?.stem ?? ''),
        options: (b.question?.options ?? []).map((o: unknown) =>
          typeof o === 'string' ? o : String((o as Record<string, unknown>)?.text ?? ''),
        ),
        answerIndex: normalizeChoiceAnswer(b.answer),
      }));
  }, []);

  // LessonRenderer 每次判定都會呼叫 onExerciseChange。這裡只把「第一次」收下來。
  const absorbInto = useCallback(
    (e: { answers: Record<string, unknown>; feedback: Record<string, boolean | null> }, lesson: unknown) => {
      const blocks = reviewableBlocksOf(lesson as { blocks?: unknown[] });
      setFirstTry((prev) => absorbVerdicts(prev, e.feedback ?? {}, e.answers ?? {}, blocks));
    },
    [reviewableBlocksOf],
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
    // 閱讀理解 = 只有選擇題（這一頁的 hint 就寫「回答課文理解選擇題」）。`lesson` 是整份
    // 故事轉出來的，`storyToLesson` 把 story.multipleChoice **和** story.fillInBlank 兩組
    // 資料都轉成 exercise block 塞進同一份 lesson.blocks —— 但 fill_in_blank（語詞應用）
    // 已經是獨立步驟「語詞應用」（`vocab-application` / `VocabApplication.tsx`）的專屬內容，
    // 走完全不同的程式碼路徑（`story.fillInBlank` → `FillInBlankExercise`，不經過
    // storyToLesson/LessonRenderer），自己有一套作答/計分/重做錯題機制。不濾掉的話，
    // 學生在「語詞應用」答完這 8 句，會在「閱讀理解」原封不動再看到一次；且
    // `LessonRenderer` 的 `allDone` 把非 custom/非 needsReview 的 exercise 全算進分母，
    // 於是「閱讀理解完成」被撐大成要答對 13 題（5 選擇題 + 8 填空），不是產品設計要的
    // 5 題（#2779，由 #2775/#2777 分頁症狀修復時交叉發現）。
    // 只濾掉「exercise 且非 multiple_choice」的 block；課文/圖表等閱讀素材照舊全部保留，
    // 不動 storyToLesson() 本身 —— 語詞應用不經過這個 adapter，改這裡風險最小。
    const comprehensionLesson = lesson
      ? { ...lesson, blocks: lesson.blocks.filter(
          (b) => b.type !== 'exercise' || b.question.kind === 'multiple_choice',
        ) }
      : lesson;
    // Only adopt a Lesson here if it actually carries COMPREHENSION content (a
    // multiple_choice exercise). The AI-extracted lessons are 閱讀聚光燈-ONLY (guided_steps /
    // graphic_text_integration) and must NOT hijack the 閱讀理解 step — without this guard the
    // comprehension page would render the spotlight (the reading-strategy content). When the
    // lesson has no MCQ, fall through to the legacy comprehension layout.
    const lessonHasMcq =
      !!comprehensionLesson &&
      comprehensionLesson.blocks.some((b) => b.type === 'exercise' && b.question.kind === 'multiple_choice');
    if (comprehensionLesson && lessonHasMcq) {
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-4 py-6">
          <OmoPaperResultBanner stepId="comprehension" />
          <LessonRenderer
            sectionLabel="閱讀理解"
            lesson={comprehensionLesson}
            story={selectedStory}
            lessonCode={selectedStory.lesson_code || selectedStory.id}
            onComplete={handleLessonRendererComplete}
            onExerciseChange={(e) => absorbInto(e, comprehensionLesson)}
          />
          {mcqDone ? (
            <>
              {/* 🔴 只在 mcqDone 之後 render —— 作答中不可能看到正解。
                  `WrongAnswerReviewList` 自己也 fail-closed（revealed 沒明確傳 true
                  就什麼都不畫），這裡是第二道。 */}
              <WrongAnswerReviewList
                revealed
                items={reviewItemsOf(firstTry, reviewableBlocksOf(comprehensionLesson)).map((it) => ({
                  id: it.id,
                  promptText: it.stem,
                  correct: false,
                  correctAnswerText: it.correctAnswer,
                  studentAnswerText: it.studentAnswer,
                }))}
              />
              <NextStepFooter onNext={handleNext} />
            </>
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
            <NextStepFooter onNext={handleNext} />
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
          {/* 空狀態也走同一顆 footer —— 學生每一步看到的「下一關」要一樣。 */}
          <NextStepFooter onNext={handleSkip} label="跳過，下一關" />
        </div>
      )}
    </ComprehensionLayout>
  );
};

export default ComprehensionMcqPage;

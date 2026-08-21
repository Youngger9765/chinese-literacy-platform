/**
 * ComprehensionMcqPage — Step: 閱讀理解 (comprehension, dbStep 3)
 *
 * Replaces ComprehensionPage / ComprehensionChat for the MCQ-only step.
 * Wraps ComprehensionLayout + MultipleChoiceExercise.
 * When the lesson has no MCQ data, shows a placeholder + skip button.
 * Calls handleFinishComprehension from LearningContext when done.
 */
import React, { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ComprehensionLayout from '../../components/reading-steps/ComprehensionLayout';
import MultipleChoiceExercise from '../../components/reading-steps/MultipleChoiceExercise';
import OmoPaperResultBanner from '../../components/reading-steps/OmoPaperResultBanner';
import { useLearningContext } from '../../layouts/LearningLayout';
import { ComprehensionResult } from '../../types';
import { LESSON_RENDERER_V1 } from '../../config/featureFlags';
import LessonRenderer from '../../components/lesson-content/LessonRenderer';
import { WrongAnswerReviewList } from '../../components/learning/WrongAnswerReviewList';
import { isToolboxMode } from '../../services/learningStorageScope';
import QuizCompletionScreen from '../../components/learning/QuizCompletionScreen';
import { firstTryScore, wrongFirstTryIds, type FirstTryRecord } from '../../utils/questionReview';
import { absorbVerdicts, allReviewItemsOf, type ReviewableBlock } from './comprehensionReview';
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
    stepProgressData,
  } = useLearningContext();

  // #2839：這一步先前存下的進度快照。用 ref 凍結在「第一次 render 當下」的值，因為
  // `LessonRenderer` 的 `initialState` 是 lazy useState initializer（只在 mount 讀一次）——
  // 若讓它跟著每次 patch 後的新 stepProgressData 變動，讀到的會是自己剛寫回去的值，
  // 語意變得繞。LearningLayout 的 `waitingForProgress` gate（#1549）保證 DB 載完才
  // render 這一頁，所以第一次 render 拿到的就已經是 DB 的值。
  const savedStepDataRef = useRef<Record<string, unknown> | null>(null);
  if (savedStepDataRef.current === null) {
    const fromDb = (stepProgressData?.step_data as Record<string, unknown> | undefined)?.comprehension;
    savedStepDataRef.current = (fromDb && typeof fromDb === 'object' ? fromDb : {}) as Record<string, unknown>;
  }
  const savedStepData = savedStepDataRef.current;

  const [mcqDone, setMcqDone] = useState(false);
  const [mcqResult, setMcqResult] = useState<{ score: number; total: number } | null>(null);
  // 第一次作答的對錯。重試不覆蓋 —— 學生一定會重試到對，
  // 拿「當下還錯的」當錯題來源，那個集合到最後恆為空（#2784 就是這樣壞的）。
  //
  // #2839：從 DB 還原。只靠還原的 `feedback` 重算是不夠的 —— feedback 是「最新一次」
  // 的對錯，先錯後對的題目重新載入後會變成一次答對，錯題複習就少一題。
  const [firstTry, setFirstTry] = useState<FirstTryRecord<string, string>[]>(
    () => (Array.isArray(savedStepData.firstTry)
      ? (savedStepData.firstTry as FirstTryRecord<string, string>[])
      : []),
  );
  // #2834：null = 完整測驗；非 null = 「重做錯題」模式，只顯示這些 block id
  // （只在完成卡按下「重做錯題」後才會被設值，見 handleRetryWrong）。
  const [retryFilterIds, setRetryFilterIds] = useState<string[] | null>(null);

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

  // #2834「重做錯題」模式的 LessonRenderer 只顯示先前答錯的那幾題（見
  // `activeLesson` 的 blocks 過濾）。這幾題答完之後只是回到完成卡 —— 分數已經在
  // 第一次作答時定案（`firstTry` 對已存在的 id 不會被覆蓋，見 questionReview.ts
  // `recordFirstTry`），這裡不重新呼叫 `handleMcqComplete`，避免重覆 patch 進度。
  const handleRetryWrongComplete = useCallback(() => {
    setRetryFilterIds(null);
    setMcqDone(true);
  }, []);

  // lesson.blocks → 計分/錯題卡片需要的最小形狀。`normalizeChoiceAnswer` 是
  // 這個 repo 判定選擇題正解的單一權威（answer 可能是索引也可能是 'A' 字母）。
  const reviewableBlocksOf = useCallback((lesson: { blocks?: unknown[] } | null | undefined): ReviewableBlock[] => {
    if (!lesson?.blocks) return [];
    return (lesson.blocks as Array<Record<string, any>>)
      .filter((b) => b?.type === 'exercise' && b?.question?.kind === 'multiple_choice')
      .map((b) => ({
        id: String(b.id),
        // #2834：multiple_choice 的題幹欄位是 `question.question`（見
        // lessonContentAdapter.ts 跟 schema/lessonContent.ts 的 QuestionSchema）。
        // `prompt`/`stem` 是別的 question kind 用的欄位名，這裡原本只認得那兩個，
        // 對 multiple_choice 一律落到空字串 —— 完成卡逐題列表因此從沒印出過題目
        // 原文（Young 2026-08-21：「而且從截圖看，錯題列表只有…沒有題目原文」）。
        stem: String(b.question?.question ?? b.question?.prompt ?? b.question?.stem ?? ''),
        options: (b.question?.options ?? []).map((o: unknown) =>
          typeof o === 'string' ? o : String((o as Record<string, unknown>)?.text ?? ''),
        ),
        answerIndex: normalizeChoiceAnswer(b.answer),
      }));
  }, []);

  // `firstTry` 的鏡像。`absorbInto` 需要「合併後」的值來存進度，但合併不可以寫在
  // `setFirstTry(prev => ...)` 的 updater 裡再順手 patch —— updater 必須是純函式
  // （StrictMode 會重複呼叫）。所以合併算在外面，ref 負責記住最新值。
  const firstTryRef = useRef<FirstTryRecord<string, string>[]>(firstTry);

  // 跨「整份測驗」與「重做錯題」累積的完整作答。**不可以**直接把 LessonRenderer
  // 當下 emit 的 `e.answers` 存進 DB（code review 抓到，已補回歸測試）：
  // 「重做錯題」會掛一個只含錯題的新 LessonRenderer，它內部的 answers/feedback
  // 從空的開始，只會累積被重做的那幾題；而 `persistStepProgressState` 的 merge
  // 只做一層，`answers` 是整包換掉 —— 於是先前答對的那幾題會被從進度裡刷掉。
  // 學生這時關掉分頁，重新載入就只剩重做的那幾題要重答，正是 #2839 本身。
  const fullAnswersRef = useRef<Record<string, unknown>>(
    (savedStepData.answers as Record<string, unknown> | undefined) ?? {},
  );
  const fullFeedbackRef = useRef<Record<string, boolean | null>>(
    (savedStepData.feedback as Record<string, boolean | null> | undefined) ?? {},
  );

  // LessonRenderer 每次判定都會呼叫 onExerciseChange。這裡只把「第一次」收下來。
  //
  // #2839：這裡同時是「作答中存進度」的唯一入口。原本這個 callback 只做計分
  // （`setFirstTry`），答案完全沒有轉給 `handleProgressChange`，於是 payload 在作答中
  // 從頭到尾沒變過，`persistStepProgressState` 的 dedup 正確地判定「沒變化」→
  // 一次 PUT 都不會發出去。傳輸層沒問題，是這條線沒接上。
  const absorbInto = useCallback(
    (e: { answers: Record<string, unknown>; feedback: Record<string, boolean | null> }, lesson: unknown) => {
      const blocks = reviewableBlocksOf(lesson as { blocks?: unknown[] });
      const nextFirstTry = absorbVerdicts(firstTryRef.current, e.feedback ?? {}, e.answers ?? {}, blocks);
      firstTryRef.current = nextFirstTry;
      setFirstTry(nextFirstTry);

      // 作答中的快照 —— 不標記完成（交卷走 handleNext / handleMcqComplete）。
      // `immediate: false` 讓 useProgressSync 的 5 秒 debounce 把連續作答收斂成一次
      // PUT，不會每點一下就打一次 rate-limited 端點。
      fullAnswersRef.current = { ...fullAnswersRef.current, ...(e.answers ?? {}) };
      fullFeedbackRef.current = { ...fullFeedbackRef.current, ...(e.feedback ?? {}) };
      handleProgressChange(
        {
          answers: fullAnswersRef.current,
          feedback: fullFeedbackRef.current,
          firstTry: nextFirstTry,
        },
        false,
      );
    },
    [reviewableBlocksOf, handleProgressChange],
  );

  // #2834：完成卡「重做錯題」——只把先前 first-try 答錯的 block id 記下來，
  // 讓底下的 LessonRenderer 過濾成只顯示這些題（見 activeLesson）。分數/firstTry
  // 完全不動，這是給學生練習用的，不是重新測驗。
  const handleRetryWrong = useCallback(() => {
    setRetryFilterIds(wrongFirstTryIds(firstTry));
    setMcqDone(false);
  }, [firstTry]);

  // #2834：完成卡「全部重做」——徹底重置，等同學生第一次進到這個步驟。
  const handleRetryAll = useCallback(() => {
    firstTryRef.current = [];
    fullAnswersRef.current = {};
    fullFeedbackRef.current = {};
    setFirstTry([]);
    setMcqResult(null);
    setRetryFilterIds(null);
    setMcqDone(false);
  }, []);

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
      // #2834：完成卡取代整個作答畫面（跟 vocab-application 一樣是「兩個互斥的
      // phase」，不是作答區跟結算並排顯示）——mcqDone 時完全不 render LessonRenderer。
      if (mcqDone) {
        const items = allReviewItemsOf(firstTry, reviewableBlocksOf(comprehensionLesson)).map((it) => ({
          id: it.id,
          promptText: it.stem,
          correct: it.correct,
          correctAnswerText: it.correctAnswer,
          studentAnswerText: it.studentAnswer,
        }));
        const wrongCount = items.filter((it) => !it.correct).length;
        return (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-4 py-6">
            {/* 修補 code review 發現的漏洞：mcqDone 分支原本整段換成
                QuizCompletionScreen，把這顆一起丟掉了。它自己會在沒有紙本成績時
                render 空（見檔頭「safe to drop into any step page unconditionally」），
                所以留著不影響沒有 OMO 紙本作答的學生。 */}
            <OmoPaperResultBanner stepId="comprehension" />
            <QuizCompletionScreen
              allCorrect={wrongCount === 0}
              wrongCount={wrongCount}
              onRetryWrong={handleRetryWrong}
              onRetryAll={handleRetryAll}
              onNext={handleNext}
              // #2834 code review：comprehension 是 TOOLBOX_TOOL_IDS 之一（可從
              // /tools 進來），FillInBlankExercise 兩邊都有傳 toolboxMode，這裡漏了
              // 會讓工具箱模式看到錯的 CTA、且 ToolboxCompletionActions 不會 mount
              // →toolbox_comprehension_sessions 永遠不會被寫入。
              toolboxMode={isToolboxMode()}
            >
              {/* 🔴 只有完成卡（mcqDone）才會走到這裡 —— 作答中不可能看到正解。
                  `WrongAnswerReviewList` 自己也 fail-closed（revealed 沒明確傳 true
                  就什麼都不畫），這裡是第二道。 */}
              <WrongAnswerReviewList revealed items={items} />
            </QuizCompletionScreen>
          </div>
        );
      }

      // #2834「重做錯題」：只把先前答錯的 block 留在 exercise 區，其餘 exercise
      // block（已答對的）拿掉；非 exercise block（課文/圖表等參考素材）照舊全留。
      // ⚠️ 不可用 useMemo 包這行——這裡在條件式的 render 分支裡（`if (mcqDone)` 之後、
      // `if (comprehensionLesson && lessonHasMcq)` 裡面），Hooks 規則不允許 hook
      // 條件式呼叫。跟上面 `comprehensionLesson`/`lessonHasMcq` 一樣是既有的
      // unmemoized 模式（code review 有指出：每次 render 都是新物件參考，會讓
      // LessonRenderer 內部 keyed on lesson.blocks 的 useMemo 跟著每次重算）——
      // 這是這個檔案原本就有的特性，不是這次改動新引入的，這次不擴大處理範圍去修。
      const activeLesson = retryFilterIds
        ? {
            ...comprehensionLesson,
            blocks: comprehensionLesson.blocks.filter(
              (b) => b.type !== 'exercise' || retryFilterIds.includes(b.id),
            ),
          }
        : comprehensionLesson;

      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-4 py-6">
          <OmoPaperResultBanner stepId="comprehension" />
          <LessonRenderer
            sectionLabel="閱讀理解"
            lesson={activeLesson}
            story={selectedStory}
            lessonCode={selectedStory.lesson_code || selectedStory.id}
            onComplete={retryFilterIds ? handleRetryWrongComplete : handleLessonRendererComplete}
            onExerciseChange={(e) => absorbInto(e, activeLesson)}
            // #2839：把 DB 存下的作答還原回來。`LessonRenderer` 早就支援 `initialState`
            // （answers/feedback 兩個 lazy useState initializer），這一頁從來沒傳過 ——
            // 存了讀不回來就等於沒存，所以存跟還原一起接上。
            initialState={{
              answers: savedStepData.answers ?? {},
              feedback: savedStepData.feedback ?? {},
            }}
          />
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

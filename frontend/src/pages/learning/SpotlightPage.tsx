/**
 * SpotlightPage — Step: 閱讀聚光燈 (reading-strategy, dbStep 16)
 *
 * v2 (#2205): BlockSequenceRenderer when spotlightV2.blocks present (dev7).
 * Legacy: StrategyExercise / GraphicTextIntegrationExercise via ComprehensionLayout.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { mergeFirstVerdicts } from '../../utils/firstVerdicts';
import { readAttempts, scoredAttempt, type AttemptRow } from '../../utils/stepAttempts';

/** 對錯的指紋：變了就代表學生改過答案（#4087）。 */
const verdictSig = (fb: unknown) =>
  JSON.stringify(
    Object.entries((fb && typeof fb === 'object' ? fb : {}) as Record<string, unknown>)
      .filter(([, v]) => v === true || v === false)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/** 這一次的逐題結果：有作答紀錄（spotlight_v2）就用它，否則只列對錯。 */
const rowsOf = (state: Record<string, unknown>, verdicts: Record<string, unknown>): AttemptRow[] => {
  const log = (state.answerLog && typeof state.answerLog === 'object' ? state.answerLog : {}) as Record<
    string,
    { order?: number; label?: string; firstAnswer?: string; latestAnswer?: string; correctAnswer?: string | null }
  >;
  const keys = Object.keys(log).length
    ? Object.keys(log).sort((a, b) => (log[a].order ?? 0) - (log[b].order ?? 0))
    : Object.keys(verdicts).filter((k) => verdicts[k] === true || verdicts[k] === false);
  return keys.map((k, i) => {
    const correct = verdicts[k] === true;
    const e = log[k];
    const answered = verdicts === state.feedback ? e?.latestAnswer : e?.firstAnswer;
    return {
      label: `第 ${i + 1} 題`,
      prompt: e?.label || null,
      correct,
      studentAnswer: correct ? null : answered ?? null,
      correctAnswer: correct ? null : e?.correctAnswer ?? null,
    };
  });
};


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

  // #4081：每題「第一次」的對錯。渲染器回報的 feedback 是最新一次 —— 聚光燈要全部答對
  // 才能完成，所以最後一定是全對，報告永遠滿分、有錯過的題目也不會變黃色。第一次判定
  // 出來的對錯只寫一次，之後重答不覆蓋（同閱讀理解的 firstTry）。
  const firstFeedbackRef = useRef<Record<string, boolean> | null>(null);
  if (firstFeedbackRef.current === null) {
    const saved = savedStrategyData?.firstFeedback;
    firstFeedbackRef.current =
      saved && typeof saved === 'object' ? { ...(saved as Record<string, boolean>) } : {};
  }

  // ── #4087：每一次作答記一筆（成績單折線圖）─────────────────────────────
  // 「做完」那一次：每次掛載只記一筆。spotlight_v2 每按一次「確認」都會檢查完成度，
  // 做完之後每訂正一題都會再回報一次完成 —— 那些是訂正，不是新的一輪。
  // 從 DB 還原成「已完成」視同已經記過。
  // 「訂正」：做完之後改了答案（含從成績單「回去訂正」回來），離開這一關時記一筆
  // retry-wrong，成績 = 當下總共答對幾題。
  const completionRecordedRef = useRef(!!savedStrategyData?.allDone);
  const lastRecordedSigRef = useRef(verdictSig(savedStrategyData?.feedback));
  const correctionPendingRef = useRef(false);
  const latestStateRef = useRef<Record<string, unknown>>(savedStrategyData ?? {});
  const attemptsMadeRef = useRef(0);

  const recordAttempt = useCallback(
    (kind: 'first' | 'retry-all' | 'retry-wrong', rows: AttemptRow[]) => {
      if (!rows.length) return; // 沒有可判對錯的題目（純閱讀的聚光燈），不畫折線
      attemptsMadeRef.current += 1;
      saveStepProgressPatch({
        stepId: 'spotlight',
        stepData: {},
        currentStep: 'spotlight',
        immediate: true,
        appendAttempt: scoredAttempt(kind, rows.filter((r) => r.correct).length, rows.length, rows),
      });
    },
    [saveStepProgressPatch],
  );

  const flushCorrection = useCallback(() => {
    if (!correctionPendingRef.current) return;
    correctionPendingRef.current = false;
    const state = latestStateRef.current;
    lastRecordedSigRef.current = verdictSig(state.feedback);
    recordAttempt('retry-wrong', rowsOf(state, (state.feedback ?? {}) as Record<string, unknown>));
  }, [recordAttempt]);

  const handleAnswerChange = useCallback(
    (exerciseState: Record<string, unknown>) => {
      const first = mergeFirstVerdicts(firstFeedbackRef.current ?? {}, exerciseState.feedback);
      firstFeedbackRef.current = first;
      const state = { ...exerciseState, firstFeedback: first };
      latestStateRef.current = state;
      if (exerciseState.allDone === true && !completionRecordedRef.current) {
        // 「做完」那一次在這裡記，不在 onComplete 裡：渲染器在最後一題的「確認」當下
        // 就同步回報完成，那時最後一題的對錯還沒透過 onChange 傳過來 —— 實測記成
        // 5/8，少了最後一題。走到這裡的 state 已經含 allDone 與最後一題的對錯。
        completionRecordedRef.current = true;
        lastRecordedSigRef.current = verdictSig(exerciseState.feedback);
        correctionPendingRef.current = false;
        const kind = readAttempts(savedStrategyData).length || attemptsMadeRef.current ? 'retry-all' : 'first';
        recordAttempt(kind, rowsOf(state, first));
      } else if (completionRecordedRef.current && verdictSig(exerciseState.feedback) !== lastRecordedSigRef.current) {
        correctionPendingRef.current = true;
        // 錯題全部改對 = 這一輪訂正做完，當下就記，不等離開頁面（整頁重新整理或直接
        // 關掉分頁時，卸載的那一下不會跑）。只改了一部分的，離開時再記。
        // 「全部改對」= 每一題判過的題目現在都是對的。改答案的當下那一題會先回到「待確認」
        // （null），那還不算改好 —— 只看「沒有錯的」會在那一下提早記一筆（實測多記了 8/9）。
        const latest = (exerciseState.feedback ?? {}) as Record<string, unknown>;
        if (Object.keys(first).every((k) => latest[k] === true)) {
          correctionPendingRef.current = false;
          lastRecordedSigRef.current = verdictSig(exerciseState.feedback);
          recordAttempt('retry-wrong', rowsOf(state, (exerciseState.feedback ?? {}) as Record<string, unknown>));
        }
      }
      handleProgressChange(state, false);
    },
    [handleProgressChange, recordAttempt, savedStrategyData],
  );

  // 作答紀錄在 handleAnswerChange 收到 allDone 時才記（見那裡的說明）。
  const handleStrategyComplete = useCallback(() => {
    setStrategyDone(true);
  }, []);

  // 離開這一頁（切到別關、回成績單）也要把訂正記下來。
  const flushCorrectionRef = useRef(flushCorrection);
  useEffect(() => { flushCorrectionRef.current = flushCorrection; }, [flushCorrection]);
  useEffect(() => {
    // 分頁被關掉 / 切走時也記（只改了一部分就離開的那一輪）。
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushCorrectionRef.current();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      flushCorrectionRef.current();
    };
  }, []);

  const handleNext = useCallback(() => {
    flushCorrection();
    handleProgressChange({ completed: true, strategyDone }, true);
    handleFinishReadingStrategy();
  }, [flushCorrection, handleFinishReadingStrategy, handleProgressChange, strategyDone]);

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

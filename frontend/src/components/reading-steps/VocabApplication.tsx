/**
 * VocabApplication — Step Component for ④ 語詞應用（造句填空練習）
 *
 * Issue #668 — 三民步驟四：語詞應用模組
 * Issue #709 — 語詞應用進度持久化 (localStorage + DB)
 * Issue #758 — 語詞應用完成紀錄不持久化 (fix: don't delete on finish)
 *
 * Standalone step component. Receives `story` prop and calls `onFinish`
 * with a score result when the student completes all fill-in-blank exercises.
 *
 * Props: { story, onFinish, fontSizePx?, saveStepProgressPatch? }
 *
 * Persistence strategy:
 * - FillInBlankExercise saves in-progress answers to localStorage on every
 *   selection (key: `vocab_app_progress_${story.id}`, Issue #709).
 * - VocabApplication saves phase/result to `vocabApp_progress_${story.id}`.
 * - On completion, DB is updated via `saveStepProgressPatch` which merges into
 *   LearningLayout's authoritative step_progress — does NOT overwrite other
 *   steps' completion state (#1196).
 * - On page unload (beforeunload), mid-exercise state is patched without
 *   touching `steps_completed`; the done-phase flushes with `markCompleted`.
 * - On manual redo, both localStorage keys are cleared.
 * - Fix #758: handleFinish no longer removes phase storage — completion persists.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story } from '../../types';
import FillInBlankExercise from './FillInBlankExercise';
import type { QuestionResult, SavedProgress as ExerciseProgress } from './FillInBlankExercise';
import { getLearningStorageScope, scopedStepStorageKey } from '../../services/learningStorageScope';
import NextStepFooter from '../learning/NextStepFooter';
import { readAttempts, scoredAttempt, type StepAttempt } from '../../utils/stepAttempts';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface VocabApplicationResult {
  score: number;
  total: number;
  completionRate: number;  // 0–1
}

export interface VocabApplicationProps {
  story: Story;
  onFinish: (result: VocabApplicationResult) => void;
  /** Base font size in px for accessibility scaling */
  fontSizePx?: number;
  /**
   * Merge-based progress patch from LearningLayout (preserves other steps' data
   * and completed list). Only touches step_data[stepId] and optionally appends
   * stepId to steps_completed. Replaces the old syncProgress/flushProgress pair
   * that overwrote the entire snapshot.
   */
  saveStepProgressPatch?: (opts: {
    stepId: string;
    stepData: Record<string, unknown>;
    currentStep?: string | null;
    markCompleted?: boolean;
    immediate?: boolean;
    appendAttempt?: StepAttempt;
  }) => void;
  /**
   * #2848 — DB 裡 `step_data['vocab-application']` 先前存下的內容。
   * 存了讀不回來等於沒存，所以「存」跟「還原」一起接上。
   */
  initialProgress?: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

/** Shown when the story has no fill-in-blank data */
function NoDataFallback({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-surface">
      <div className="text-center space-y-4 p-8">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">edit_note</span>
        <p className="text-on-surface-variant">本課尚無語詞應用題目</p>
        <NextStepFooter onNext={onFinish} />
      </div>
    </div>
  );
}

/* CompletionScreen removed — FillInBlankExercise now has its own summary screen */

/* ------------------------------------------------------------------ */
/*  localStorage helpers (phase + result persistence)                  */
/* ------------------------------------------------------------------ */

const PHASE_STORAGE_PREFIX = 'vocabApp_progress_';
const ANSWER_STORAGE_PREFIX = 'vocab_app_progress_';

function phaseStorageKey(storyId: string | number) {
  return scopedStepStorageKey(PHASE_STORAGE_PREFIX, storyId);
}

function answerStorageKey(storyId: string | number) {
  return scopedStepStorageKey(ANSWER_STORAGE_PREFIX, storyId);
}

function clearAllStorageForStory(storyId: string | number) {
  try { localStorage.removeItem(phaseStorageKey(storyId)); } catch {}
  try { localStorage.removeItem(answerStorageKey(storyId)); } catch {}
}

/* ------------------------------------------------------------------ */
/*  Saved progress type (extended for #758)                            */
/* ------------------------------------------------------------------ */

interface SavedPhaseProgress {
  phase: 'exercise' | 'done';
  result: { score: number; total: number } | null;
  firstTryResults?: QuestionResult[];
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

const VocabApplication: React.FC<VocabApplicationProps> = ({
  story,
  onFinish,
  fontSizePx,
  saveStepProgressPatch,
  initialProgress,
}) => {
  const storageKey = phaseStorageKey(story.id);
  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as SavedPhaseProgress;
    } catch { return null; }
  };
  // #4081：完成狀態與成績以 DB 為準。以前只從瀏覽器快取還原 —— 換裝置看不到完成
  // 畫面；同一台裝置上快取裡的舊「已完成」+ 舊分數，一掛載又被當成這一次的成績標完成
  // 存回 DB。DB 有完成紀錄就用它；在學習流程裡（有 DB 可寫）但 DB 沒有完成紀錄時，
  // 不相信快取的「已完成」；沒有 DB 可寫時（例如沒有 session）才用快取。
  const savedProgress = useRef<SavedPhaseProgress | null>(null);
  if (savedProgress.current === null) {
    const dbScore = typeof initialProgress?.score === 'number' ? initialProgress.score : null;
    const dbTotal = typeof initialProgress?.total === 'number' ? initialProgress.total : null;
    if (dbScore !== null && dbTotal !== null) {
      savedProgress.current = {
        phase: 'done',
        result: { score: dbScore, total: dbTotal },
        firstTryResults: Array.isArray(initialProgress?.firstTryResults)
          ? (initialProgress.firstTryResults as QuestionResult[])
          : [],
      };
    } else {
      const cached = loadSaved();
      savedProgress.current = saveStepProgressPatch && cached?.phase === 'done'
        ? { phase: 'exercise', result: null, firstTryResults: [] }
        : cached ?? { phase: 'exercise', result: null, firstTryResults: [] };
    }
  }
  // 從 DB 還原出來的完成狀態不用再寫一次（下面的完成 effect 掛載時會跑）。
  const skipRestoredCompletionRef = useRef(
    typeof initialProgress?.score === 'number' && typeof initialProgress?.total === 'number',
  );

  const [phase, setPhase] = useState<'exercise' | 'done'>(() => savedProgress.current?.phase ?? 'exercise');
  const [result, setResult] = useState<{ score: number; total: number } | null>(() => savedProgress.current?.result ?? null);
  const [savedFirstTryResults, setSavedFirstTryResults] = useState<QuestionResult[]>(
    () => savedProgress.current?.firstTryResults ?? [],
  );

  const sentences = useMemo(() => story.fillInBlank ?? [], [story.fillInBlank]);
  const vocabBank = useMemo(() => story.vocabBank ?? {}, [story.vocabBank]);
  const hasData = sentences.length > 0 && Object.keys(vocabBank).length > 0;

  // ── localStorage persistence (phase + result + firstTryResults) ───────────
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ phase, result, firstTryResults: savedFirstTryResults }));
    } catch {}
  }, [phase, result, savedFirstTryResults, storageKey]);

  // ── DB restore + mid-exercise DB persistence (#2848) ─────────────────────
  // 之前這一關作答中完全不進 DB：逐題答案只寫 localStorage，DB 只在做完時收到
  // 最終成績。2026-08-21 staging 實測答 1 題等 12 秒 → 0 次 PUT、
  // `step_progress` 仍是 null。換裝置 / 清快取就整關重來。
  //
  // 用 ref 把還原快照凍結在「第一次 render 當下」：下面的 patch 會讓
  // LearningLayout 的 stepProgressData 更新，若讓它跟著變，讀到的會是自己剛寫
  // 回去的值。LearningLayout 的 waitingForProgress gate（#1549）保證 DB 載完才
  // render 這一頁，所以第一次 render 拿到的就已經是 DB 的值。
  const restoredExerciseRef = useRef<ExerciseProgress | null | undefined>(undefined);
  if (restoredExerciseRef.current === undefined) {
    const raw = initialProgress?.exercise;
    restoredExerciseRef.current =
      raw && typeof raw === 'object' ? (raw as ExerciseProgress) : null;
  }

  const handleExerciseProgress = useCallback(
    (progress: ExerciseProgress) => {
      if (!saveStepProgressPatch) return;
      // 作答中的快照 —— **不可以** markCompleted。標了完成，學生才答一題報告頁
      // 就會把整步算成做完。交卷走 handleComplete 那條（markCompleted: true）。
      // immediate: false 讓 useProgressSync 的 debounce 把連續作答收斂成一次 PUT，
      // 不會每點一下就打一次 rate-limited 端點。
      saveStepProgressPatch({
        stepId: 'vocab-application',
        currentStep: 'vocab-application',
        immediate: false,
        stepData: { phase: 'exercise', exercise: progress },
      });
    },
    [saveStepProgressPatch],
  );

  // ── DB persistence on completion ─────────────────────────────────────────
  // When phase transitions to 'done', flush progress to DB immediately via patch
  // (merges with other steps' data instead of overwriting the snapshot).
  useEffect(() => {
    if (skipRestoredCompletionRef.current) {
      skipRestoredCompletionRef.current = false;
      if (phase === 'done') return;
    }
    if (phase === 'done' && result && saveStepProgressPatch) {
      // Issue #2070: include firstTryResults so teachers can see per-question
      // first-attempt accuracy, not just the aggregate score.
      // firstTryResults shape: { sentenceIdx: number; firstTryCorrect: boolean }[]
      // Stored in step_progress.step_data['vocab-application'].firstTryResults
      // (no new table needed — step_data JSONB already exists).
      saveStepProgressPatch({
        stepId: 'vocab-application',
        currentStep: 'vocab-application',
        markCompleted: true,
        immediate: true,
        stepData: {
          score: result.score,
          total: result.total,
          completionRate: result.total > 0 ? result.score / result.total : 1,
          completedAt: new Date().toISOString(),
          firstTryResults: savedFirstTryResults,
        },
      });
    }
  }, [phase, result, savedFirstTryResults, saveStepProgressPatch]);

  // ── DB persistence on page unload (beforeunload) ─────────────────────────
  // Uses patch semantics so we never overwrite other steps' progress.
  const patchRef = useRef(saveStepProgressPatch);
  const phaseRef = useRef(phase);
  const resultRef = useRef(result);
  const firstTryResultsRef = useRef(savedFirstTryResults);
  useEffect(() => { patchRef.current = saveStepProgressPatch; }, [saveStepProgressPatch]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { resultRef.current = result; }, [result]);
  useEffect(() => { firstTryResultsRef.current = savedFirstTryResults; }, [savedFirstTryResults]);

  useEffect(() => {
    function handleBeforeUnload() {
      const patch = patchRef.current;
      if (!patch) return;
      const currentPhase = phaseRef.current;
      const currentResult = resultRef.current;

      if (currentPhase === 'exercise') {
        // Mid-exercise: record that the student is working on vocab-application
        // WITHOUT touching steps_completed (#1196).  markCompleted stays false.
        patch({
          stepId: 'vocab-application',
          currentStep: 'vocab-application',
          immediate: true,
          stepData: { phase: 'exercise', partialAt: new Date().toISOString() },
        });
      } else if (currentPhase === 'done' && currentResult) {
        // Completed but user is leaving — make sure it's flushed
        // Include firstTryResults so per-question data survives page-close (#2070).
        patch({
          stepId: 'vocab-application',
          currentStep: 'vocab-application',
          markCompleted: true,
          immediate: true,
          stepData: {
            score: currentResult.score,
            total: currentResult.total,
            completionRate: currentResult.total > 0 ? currentResult.score / currentResult.total : 1,
            firstTryResults: firstTryResultsRef.current,
          },
        });
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Issue #758: accept firstTryResults from FillInBlankExercise and persist them
  // ── #4087：每做完一輪記一筆作答（成績單折線圖）─────────────────────────
  // 第一次做完 / 全部重做 → 這一輪第一次就答對的題數；重做錯題 → 做完這一輪之後
  // 總共答對幾題（原本就對的 + 這一輪重做時第一次就對的）。
  const attemptsMadeRef = useRef(readAttempts(initialProgress).length);
  const handleRoundFinished = useCallback(
    (round: { retryMode: boolean; firstTryResults: QuestionResult[]; retryOutcome: Record<number, { correct: boolean; firstAnswer: string | null }> }) => {
      if (!saveStepProgressPatch) return;
      const wordOf = (code: string | null | undefined) => (code ? vocabBank[code] ?? code : null);
      const kind = round.retryMode ? 'retry-wrong' : attemptsMadeRef.current > 0 ? 'retry-all' : 'first';
      const bySentence = new Map(round.firstTryResults.map((r) => [r.sentenceIdx, r]));
      const rows = sentences.map((sentence, i) => {
        const original = bySentence.get(i);
        const retried = round.retryMode ? round.retryOutcome[i] : undefined;
        const correct = retried ? retried.correct : original?.firstTryCorrect === true;
        const firstAnswer = retried ? retried.firstAnswer : original?.studentFirstAnswer ?? null;
        return {
          label: `第 ${i + 1} 題`,
          correct,
          studentAnswer: correct ? null : wordOf(firstAnswer as string | null),
          correctAnswer: wordOf(sentence.answer),
        };
      });
      attemptsMadeRef.current += 1;
      saveStepProgressPatch({
        stepId: 'vocab-application',
        currentStep: 'vocab-application',
        immediate: true,
        stepData: {},
        appendAttempt: scoredAttempt(kind, rows.filter((r) => r.correct).length, rows.length, rows),
      });
    },
    [saveStepProgressPatch, sentences, vocabBank],
  );

  function handleComplete(score: number, total: number, firstTryResults?: QuestionResult[]) {
    setResult({ score, total });
    if (firstTryResults) {
      setSavedFirstTryResults(firstTryResults);
    }
    setPhase('done');
    // Navigate to next step — FillInBlankExercise already shows its own summary,
    // so when it calls onComplete from the 下一關 footer, we proceed immediately.
    const completionRate = total > 0 ? score / total : 1;
    onFinish({ score, total, completionRate });
  }

  function handleFinish() {
    // Issue #758 fix: do NOT remove storageKey here — keep completion record so
    // navigating back shows the completion screen instead of restarting.
    const score = result?.score ?? 0;
    const total = result?.total ?? sentences.length;
    onFinish({
      score,
      total,
      completionRate: total > 0 ? score / total : 1,
    });
  }

  /** Called when student clicks "重新練習" from the completion screen.
   * Clears all localStorage and restarts the exercise from scratch. */
  function handleRedoFromDone() {
    clearAllStorageForStory(story.id);
    setSavedFirstTryResults([]);
    setPhase('exercise');
    setResult(null);
  }

  /** Called when student clicks "練習錯題" from the completion screen.
   * Clears the answer progress so FillInBlankExercise starts retry mode.
   * We stay in 'exercise' phase but clear answer storage so FillInBlankExercise
   * gets a fresh start with the wrong questions. */
  function handleRetryWrongFromDone() {
    // Clear answer storage so FillInBlankExercise initialises fresh
    try { localStorage.removeItem(answerStorageKey(story.id)); } catch {}
    setSavedFirstTryResults([]);
    setPhase('exercise');
    setResult(null);
  }

  return (
    <div
      className="flex-1 flex flex-col bg-surface overflow-hidden"
      style={fontSizePx ? { fontSize: fontSizePx } : undefined}
    >
      {!hasData ? (
        <NoDataFallback onFinish={handleFinish} />
      ) : (
        <FillInBlankExercise
          sentences={sentences}
          vocabBank={vocabBank}
          onComplete={handleComplete}
          storyId={getLearningStorageScope(story.id)}
          initialProgress={restoredExerciseRef.current}
          onProgressChange={handleExerciseProgress}
          onRoundFinished={handleRoundFinished}
        />
      )}
    </div>
  );
};

export default VocabApplication;

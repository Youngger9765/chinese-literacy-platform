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
 * Props: { story, onFinish, zhuyinActive?, fontSizePx?, token?, dbSessionId?,
 *          syncProgress?, flushProgress? }
 *
 * Persistence strategy:
 * - FillInBlankExercise saves in-progress answers to localStorage on every
 *   selection (key: `vocab_app_progress_${story.id}`, Issue #709).
 * - VocabApplication saves phase/result to `vocabApp_progress_${story.id}`.
 * - On completion, DB is updated via flushProgress (if token + dbSessionId available).
 * - On page unload (beforeunload), DB is flushed with whatever progress exists.
 * - On manual redo, both localStorage keys are cleared.
 * - Fix #758: handleFinish no longer removes phase storage — completion persists.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Story } from '../../types';
import FillInBlankExercise from './FillInBlankExercise';
import type { QuestionResult } from './FillInBlankExercise';
import type { StepProgressData } from '../../services/learningApi';

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
  /** Enable zhuyin ruby annotation (future-use, passed through) */
  zhuyinActive?: boolean;
  /** Base font size in px for accessibility scaling */
  fontSizePx?: number;
  // ── DB persistence props (Issue #709) ──────────────────────────────
  /** Auth token for step_progress API calls. Null when unauthenticated. */
  token?: string | null;
  /** DB LearningSession integer ID. Null until session is created. */
  dbSessionId?: number | null;
  /** Debounced DB sync from useProgressSync (Issue #660). */
  syncProgress?: (data: StepProgressData) => void;
  /** Immediate DB flush — use on completion or page unload (Issue #660). */
  flushProgress?: (data: StepProgressData) => void;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

/** Header banner matching other step components' amber-50 style */
function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-4">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-bold text-amber-900">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-amber-700">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/** Shown when the story has no fill-in-blank data */
function NoDataFallback({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-16 text-center max-w-lg mx-auto">
      <div className="text-5xl select-none">📝</div>
      <div>
        <h3 className="text-lg font-bold text-gray-700 mb-2">本課尚無語詞應用題目</h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          這篇課文目前沒有填空練習資料。<br />
          教師可透過後台上傳題目，或聯絡管理員更新課文資料。
        </p>
      </div>
      <button
        onClick={onFinish}
        className="rounded-lg bg-amber-500 px-8 py-3 text-white font-medium hover:bg-amber-600 transition-colors"
      >
        繼續下一步
      </button>
    </div>
  );
}

/** Completion screen shown after FillInBlankExercise reports done.
 * Shows score summary, per-question breakdown, and action buttons.
 * Issue #758: expanded from simple score display to full result view. */
function CompletionScreen({
  score,
  total,
  firstTryResults,
  vocabBank,
  sentences,
  onRetryAll,
  onRetryWrong,
  onFinish,
}: {
  score: number;
  total: number;
  firstTryResults: QuestionResult[];
  vocabBank: Record<string, string>;
  sentences: { sentence: string; answer: string }[];
  onRetryAll: () => void;
  onRetryWrong: () => void;
  onFinish: () => void;
}) {
  const perfect = score === total;
  const wrongCount = firstTryResults.filter((r) => !r.firstTryCorrect).length;

  return (
    <div className="flex flex-col gap-5 p-4 max-w-2xl mx-auto animate-fade-in">
      {/* Score header */}
      <div
        className={`rounded-2xl px-6 py-5 text-center border ${
          perfect
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'
        }`}
      >
        <div className="text-4xl select-none mb-2">
          {perfect ? '🌟' : '📚'}
        </div>
        <p className="text-2xl font-black text-gray-800 mb-1">
          {perfect ? '全部答對！太棒了！' : `一次答對 ${score}／${total} 題`}
        </p>
        <p className="text-sm text-gray-500">
          {perfect
            ? '每一題都一次答對，表現優異！'
            : '以下是各題的一次作答結果'}
        </p>
      </div>

      {/* Per-question breakdown */}
      {firstTryResults.length > 0 && (
        <div className="flex flex-col gap-3">
          {sentences.map((s, idx) => {
            const qResult = firstTryResults.find((r) => r.sentenceIdx === idx);
            const correct = qResult?.firstTryCorrect ?? false;
            const correctCode = qResult?.correctAnswer ?? '';
            const wrongCode = qResult?.studentFirstAnswer ?? null;

            return (
              <div
                key={idx}
                className={`rounded-xl border p-4 ${
                  correct
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl flex-shrink-0 mt-0.5">
                    {correct ? '✅' : '❌'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-base text-gray-700 leading-relaxed mb-1">
                      {s.sentence.replace(
                        '(　　)',
                        `【${vocabBank[correctCode] ?? correctCode}】`,
                      )}
                    </p>
                    {!correct && wrongCode && (
                      <p className="text-sm text-red-600">
                        你選了：
                        <span className="font-semibold mx-1">
                          {wrongCode}·{vocabBank[wrongCode] ?? wrongCode}
                        </span>
                        <span className="text-gray-500 mx-1">→ 正確答案：</span>
                        <span className="font-semibold text-emerald-700">
                          {correctCode}·{vocabBank[correctCode] ?? correctCode}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-3">
        {wrongCount > 0 && (
          <button
            onClick={onRetryWrong}
            className="rounded-xl border-2 border-[#5B4FC4] bg-white px-8 py-3 text-base font-bold text-[#5B4FC4] hover:bg-[#5B4FC4]/5 active:scale-95 transition-all shadow-sm min-h-[52px]"
          >
            練習錯題（{wrongCount} 題）
          </button>
        )}
        <button
          onClick={onRetryAll}
          className="rounded-xl border border-gray-300 bg-white px-8 py-3 text-base font-medium text-gray-600 hover:bg-gray-50 active:scale-95 transition-all min-h-[52px]"
        >
          重新練習
        </button>
        <button
          onClick={onFinish}
          className="rounded-lg bg-emerald-500 px-10 py-3 text-white font-semibold hover:bg-emerald-600 transition-colors text-lg min-h-[52px]"
        >
          繼續下一步 →
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  localStorage helpers (phase + result persistence)                  */
/* ------------------------------------------------------------------ */

const PHASE_STORAGE_PREFIX = 'vocabApp_progress_';
const ANSWER_STORAGE_PREFIX = 'vocab_app_progress_';

function phaseStorageKey(storyId: string | number) {
  return `${PHASE_STORAGE_PREFIX}${storyId}`;
}

function answerStorageKey(storyId: string | number) {
  return `${ANSWER_STORAGE_PREFIX}${storyId}`;
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
  flushProgress,
  syncProgress,
}) => {
  const storageKey = phaseStorageKey(story.id);
  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as SavedPhaseProgress;
    } catch { return null; }
  };
  const savedProgress = useRef(loadSaved());

  const [phase, setPhase] = useState<'exercise' | 'done'>(() => savedProgress.current?.phase ?? 'exercise');
  const [result, setResult] = useState<{ score: number; total: number } | null>(() => savedProgress.current?.result ?? null);
  const [savedFirstTryResults, setSavedFirstTryResults] = useState<QuestionResult[]>(
    () => savedProgress.current?.firstTryResults ?? [],
  );

  const sentences = story.fillInBlank ?? [];
  const vocabBank = story.vocabBank ?? {};
  const hasData = sentences.length > 0 && Object.keys(vocabBank).length > 0;

  // ── localStorage persistence (phase + result + firstTryResults) ───────────
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ phase, result, firstTryResults: savedFirstTryResults }));
    } catch {}
  }, [phase, result, savedFirstTryResults, storageKey]);

  // ── DB persistence on completion ─────────────────────────────────────────
  // When phase transitions to 'done', flush progress to DB immediately
  useEffect(() => {
    if (phase === 'done' && result && flushProgress) {
      flushProgress({
        current_step: 'vocab-application',
        steps_completed: ['vocab-application'],
        step_data: {
          vocab_application: {
            score: result.score,
            total: result.total,
            completionRate: result.total > 0 ? result.score / result.total : 1,
            completedAt: new Date().toISOString(),
          },
        },
      });
    }
  }, [phase, result, flushProgress]);

  // ── DB persistence on page unload (beforeunload) ─────────────────────────
  // Sync whatever progress exists when user navigates away mid-exercise
  const flushRef = useRef(flushProgress);
  const syncRef = useRef(syncProgress);
  const phaseRef = useRef(phase);
  const resultRef = useRef(result);
  useEffect(() => { flushRef.current = flushProgress; }, [flushProgress]);
  useEffect(() => { syncRef.current = syncProgress; }, [syncProgress]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { resultRef.current = result; }, [result]);

  useEffect(() => {
    function handleBeforeUnload() {
      const flush = flushRef.current;
      if (!flush) return;
      const currentPhase = phaseRef.current;
      const currentResult = resultRef.current;

      if (currentPhase === 'exercise') {
        // Mid-exercise: sync partial progress
        const sync = syncRef.current;
        if (sync) {
          sync({
            current_step: 'vocab-application',
            steps_completed: [],
            step_data: { vocab_application: { phase: 'exercise', partialAt: new Date().toISOString() } },
          });
        }
      } else if (currentPhase === 'done' && currentResult) {
        // Completed but user is leaving — make sure it's flushed
        flush({
          current_step: 'vocab-application',
          steps_completed: ['vocab-application'],
          step_data: {
            vocab_application: {
              score: currentResult.score,
              total: currentResult.total,
              completionRate: currentResult.total > 0 ? currentResult.score / currentResult.total : 1,
            },
          },
        });
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Issue #758: accept firstTryResults from FillInBlankExercise and persist them
  function handleComplete(score: number, total: number, firstTryResults?: QuestionResult[]) {
    setResult({ score, total });
    if (firstTryResults) {
      setSavedFirstTryResults(firstTryResults);
    }
    setPhase('done');
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
      className="flex flex-col min-h-full bg-white"
      style={fontSizePx ? { fontSize: fontSizePx } : undefined}
    >
      <StepHeader
        title="語詞應用"
        subtitle="將正確的詞語代號填入空格中"
      />

      <div className="flex-1 overflow-auto py-6">
        {!hasData ? (
          <NoDataFallback onFinish={handleFinish} />
        ) : phase === 'exercise' ? (
          <FillInBlankExercise
            sentences={sentences}
            vocabBank={vocabBank}
            onComplete={handleComplete}
            storyId={story.id}
          />
        ) : (
          <CompletionScreen
            score={result!.score}
            total={result!.total}
            firstTryResults={savedFirstTryResults}
            vocabBank={vocabBank}
            sentences={sentences}
            onRetryAll={handleRedoFromDone}
            onRetryWrong={handleRetryWrongFromDone}
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>
  );
};

export default VocabApplication;

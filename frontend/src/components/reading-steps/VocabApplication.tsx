/**
 * VocabApplication — Step Component for ④ 語詞應用（造句填空練習）
 *
 * Issue #668 — 三民步驟四：語詞應用模組
 * Issue #709 — 語詞應用進度持久化 (localStorage + DB)
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
 */
import React, { useEffect, useRef, useState } from 'react';
import { Story } from '../../types';
import FillInBlankExercise from './FillInBlankExercise';
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

/** Completion screen shown after FillInBlankExercise reports done */
function CompletionScreen({
  score,
  total,
  onFinish,
}: {
  score: number;
  total: number;
  onFinish: () => void;
}) {
  const perfect = score === total;
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-16 text-center max-w-lg mx-auto animate-fade-in">
      <div className="text-5xl select-none animate-pop">
        {perfect ? '🌟' : '📚'}
      </div>
      <div>
        <h3 className="text-2xl font-black text-emerald-800 mb-1">
          {perfect ? '全部答對！' : '語詞應用完成！'}
        </h3>
        <p className="text-emerald-700 text-base">
          答對 <span className="font-bold">{score}</span> / {total} 題
          {!perfect && (
            <span className="block text-sm text-gray-500 mt-1">
              再多練習幾次，一定可以全對！
            </span>
          )}
        </p>
      </div>
      <button
        onClick={onFinish}
        className="rounded-lg bg-emerald-500 px-10 py-3 text-white font-semibold hover:bg-emerald-600 transition-colors text-lg"
      >
        繼續下一步 →
      </button>
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
      return JSON.parse(raw) as { phase: 'exercise' | 'done'; result: { score: number; total: number } | null };
    } catch { return null; }
  };
  const savedProgress = useRef(loadSaved());

  const [phase, setPhase] = useState<'exercise' | 'done'>(() => savedProgress.current?.phase ?? 'exercise');
  const [result, setResult] = useState<{ score: number; total: number } | null>(() => savedProgress.current?.result ?? null);

  const sentences = story.fillInBlank ?? [];
  const vocabBank = story.vocabBank ?? {};
  const hasData = sentences.length > 0 && Object.keys(vocabBank).length > 0;

  // ── localStorage persistence (phase + result) ────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ phase, result }));
    } catch {}
  }, [phase, result, storageKey]);

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

  function handleComplete(score: number, total: number) {
    setResult({ score, total });
    setPhase('done');
  }

  function handleFinish() {
    try { localStorage.removeItem(storageKey); } catch {}
    const score = result?.score ?? 0;
    const total = result?.total ?? sentences.length;
    onFinish({
      score,
      total,
      completionRate: total > 0 ? score / total : 1,
    });
  }

  /** Called when student clicks "再試一次" from within FillInBlankExercise.
   * VocabApplication itself doesn't have a retry — the retry is inside
   * FillInBlankExercise which clears its own localStorage. But if user
   * somehow gets here from the 'done' phase (future use), clear everything. */
  function handleRedoFromDone() {
    clearAllStorageForStory(story.id);
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
            onFinish={handleFinish}
          />
        )}
      </div>

      {/* Hidden redo trigger (accessed programmatically only, future use) */}
      {phase === 'done' && (
        <button
          onClick={handleRedoFromDone}
          className="sr-only"
          aria-label="重做語詞應用"
        >
          重做
        </button>
      )}
    </div>
  );
};

export default VocabApplication;

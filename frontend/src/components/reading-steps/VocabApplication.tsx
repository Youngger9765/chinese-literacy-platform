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
import { getLearningStorageScope, scopedStepStorageKey } from '../../services/learningStorageScope';

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
  }) => void;
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
        <button onClick={onFinish} className="btn-immersive">
          繼續下一步 <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
        </button>
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
  // When phase transitions to 'done', flush progress to DB immediately via patch
  // (merges with other steps' data instead of overwriting the snapshot).
  useEffect(() => {
    if (phase === 'done' && result && saveStepProgressPatch) {
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
        },
      });
    }
  }, [phase, result, saveStepProgressPatch]);

  // ── DB persistence on page unload (beforeunload) ─────────────────────────
  // Uses patch semantics so we never overwrite other steps' progress.
  const patchRef = useRef(saveStepProgressPatch);
  const phaseRef = useRef(phase);
  const resultRef = useRef(result);
  useEffect(() => { patchRef.current = saveStepProgressPatch; }, [saveStepProgressPatch]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { resultRef.current = result; }, [result]);

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
        patch({
          stepId: 'vocab-application',
          currentStep: 'vocab-application',
          markCompleted: true,
          immediate: true,
          stepData: {
            score: currentResult.score,
            total: currentResult.total,
            completionRate: currentResult.total > 0 ? currentResult.score / currentResult.total : 1,
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
    // Navigate to next step — FillInBlankExercise already shows its own summary,
    // so when it calls onComplete from "繼續下一步", we proceed immediately.
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
        />
      )}
    </div>
  );
};

export default VocabApplication;

/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
/**
 * VocabPractice
 *
 * #1342 additions:
 *  - practiceRound: 1 | 2 | 'done' state per character
 *    - Round 1 (仿寫): left panel (character + radical) visible
 *    - Round 2 (再生回憶): left panel hidden; student writes from memory
 *  - RadicalDecomposition now rendered with colorMode=true in round 1,
 *    and a brief mergeMode flash before transitioning to round 2
 *  - Skip button for round 2 (tracked but not blocking)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Story, ReadingAttempt, VocabResult } from '../../types';
import { hasStrokeData } from '../stroke-order/strokeData';
import WriteCharacter from '../stroke-order/WriteCharacter';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import RadicalDecomposition from './RadicalDecomposition';
import { getDecomposition, initGeneratedDecompositions, initRadicalMeanings } from '../../data/radicals';
import { scopedStepStorageKey, isToolboxMode } from '../../services/learningStorageScope';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import type { VocabStepData } from '../../types/stepProgress';

interface VocabPracticeProps {
  story: Story;
  attempt: ReadingAttempt | null;
  onFinish: (result: VocabResult) => void;
  onBack: () => void;
  /** Rehydrate from previously saved step_progress.step_data['character-practice']. */
  initialProgress?: VocabStepData;
  /** Persist incremental progress to LearningSession.step_progress (Issue #1549). */
  onProgressChange?: (stepData: VocabStepData, immediate?: boolean) => void;
}

/** Per-character practice round state */
type CharRound = 1 | 2 | 'done';

/** Convert in-memory round state to wire format (1=round1, 2=round2, 3=done). */
function roundToCode(r: CharRound): number {
  return r === 'done' ? 3 : r;
}

function codeToRound(c: number): CharRound {
  if (c === 3) return 'done';
  if (c === 2) return 2;
  return 1;
}

/* ================================================================ */
/*  Main component                                                   */
/* ================================================================ */

const VocabPractice: React.FC<VocabPracticeProps> = ({
  story,
  attempt,
  onFinish,
  onBack,
  initialProgress,
  onProgressChange,
}) => {
  // Load generated decomposition data
  const [decompReady, setDecompReady] = useState(false);
  useEffect(() => {
    Promise.all([initGeneratedDecompositions(), initRadicalMeanings()]).then(() => setDecompReady(true));
  }, []);

  const storageKey = scopedStepStorageKey('vocabPractice_progress_', story.id);

  // Rehydration order: DB-loaded initialProgress → localStorage → empty (Issue #1549).
  const loadFromLocalStorage = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as { practicedChars: string[]; currentIndex: number };
    } catch { return null; }
  };
  const savedProgress = useRef(loadFromLocalStorage());

  const [practicedChars, setPracticedChars] = useState<Set<string>>(() => {
    if (initialProgress?.practiced_chars?.length) return new Set(initialProgress.practiced_chars);
    return new Set(savedProgress.current?.practicedChars ?? []);
  });
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (typeof initialProgress?.current_index === 'number') return initialProgress.current_index;
    return savedProgress.current?.currentIndex ?? 0;
  });

  // ── #1342: per-character round tracking ──────────────────────────
  // charRounds maps char → current round. Characters start at round 1.
  // "done" = both rounds completed (or round 2 skipped).
  const [charRounds, setCharRounds] = useState<Map<string, CharRound>>(() => {
    const m = new Map<string, CharRound>();
    if (initialProgress?.char_rounds) {
      for (const [ch, code] of Object.entries(initialProgress.char_rounds)) {
        m.set(ch, codeToRound(code as number));
      }
    }
    return m;
  });

  // Whether the "合體" merge animation is playing between round 1 → 2
  const [showMergeAnimation, setShowMergeAnimation] = useState(false);

  // Tracks which chars had round 2 skipped (for analytics / reporting)
  const skippedRecallRef = useRef<Set<string>>(
    new Set(initialProgress?.skipped_recall ?? [])
  );

  const { zhuyinActive, processZhuyin } = useZhuyin();

  // Build the step_data payload from current state — pure, called by the persist effect.
  const buildStepData = useCallback(
    (overrides?: Partial<VocabStepData>): VocabStepData => {
      const charRoundsObj: Record<string, number> = {};
      charRounds.forEach((r, ch) => { charRoundsObj[ch] = roundToCode(r); });
      return {
        practiced_chars: Array.from(practicedChars),
        current_index: currentIndex,
        char_rounds: charRoundsObj,
        skipped_recall: Array.from(skippedRecallRef.current),
        ...(overrides ?? {}),
      };
    },
    [practicedChars, currentIndex, charRounds],
  );

  // Persist progress — localStorage (immediate) + DB (debounced).
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        practicedChars: Array.from(practicedChars),
        currentIndex,
      }));
    } catch {}
    onProgressChange?.(buildStepData(), false);
  }, [practicedChars, currentIndex, charRounds, storageKey, onProgressChange, buildStepData]);

  // Characters to practice
  const displayChars = useMemo(() => {
    const suggested = (attempt?.mispronouncedWords ?? []).filter(hasStrokeData);
    if (suggested.length > 0) return suggested.slice(0, 12);
    const seen = new Set<string>();
    const optional: string[] = [];
    for (const line of story.content) {
      for (const ch of line) {
        if (/[一-龥]/.test(ch) && hasStrokeData(ch) && !seen.has(ch)) {
          optional.push(ch);
          seen.add(ch);
        }
      }
    }
    return optional.slice(0, 12);
  }, [story.content, attempt?.mispronouncedWords]);

  const vocabWords = useMemo(() => {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const item of story.vocabulary ?? []) {
      const w = item.word.trim();
      if (w && !seen.has(w)) { words.push(w); seen.add(w); }
    }
    return words;
  }, [story.vocabulary]);

  // Current character
  const currentChar = displayChars[currentIndex] ?? displayChars[0] ?? '';
  const decomp = decompReady ? getDecomposition(currentChar) : null;
  const zhuyinStr = zhuyinActive ? processZhuyin(currentChar) : null;
  const allDone = displayChars.length > 0 && displayChars.every(ch => practicedChars.has(ch));

  // Current round for this character (default 1 if not set)
  const currentRound: CharRound = charRounds.get(currentChar) ?? 1;

  // ── Round helpers ─────────────────────────────────────────────────

  /**
   * Called when WriteCharacter fires onComplete (user finished all strokes).
   * Round 1 → show 合體 animation → advance to round 2.
   * Round 2 / done → mark as practiced and move to next char.
   */
  const handleCharComplete = () => {
    if (currentRound === 1) {
      // Show merge animation for ~1.2 s then switch to round 2
      setShowMergeAnimation(true);
      setCharRounds(prev => new Map(prev).set(currentChar, 2));
      setTimeout(() => setShowMergeAnimation(false), 1200);
    } else {
      // Round 2 complete — mark done and advance
      markCharDone(currentChar);
    }
  };

  const markCharDone = (ch: string) => {
    setCharRounds(prev => new Map(prev).set(ch, 'done'));
    setPracticedChars(prev => {
      const next = new Set(prev).add(ch);
      // Auto-advance to next unpracticed character (use updated set)
      const nextUnpracticed = displayChars.findIndex((c, i) => i > currentIndex && !next.has(c));
      if (nextUnpracticed >= 0) {
        setCurrentIndex(nextUnpracticed);
      } else if (currentIndex < displayChars.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
      return next;
    });
  };

  /**
   * Skip round 2 — mark as done immediately, log skip.
   */
  const handleSkipRecall = () => {
    skippedRecallRef.current.add(currentChar);
    markCharDone(currentChar);
  };

  // The "unlocked" character: first unpracticed overall (next to complete)
  const unlockedIndex = displayChars.findIndex(ch => !practicedChars.has(ch));

  const isNavigable = (i: number) =>
    practicedChars.has(displayChars[i]) || i === unlockedIndex;

  const handlePrev = () => {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (isNavigable(i)) { setCurrentIndex(i); return; }
    }
  };

  const handleNext = () => {
    for (let i = currentIndex + 1; i < displayChars.length; i++) {
      if (isNavigable(i)) { setCurrentIndex(i); return; }
    }
  };

  const canGoPrev = (() => {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (isNavigable(i)) return true;
    }
    return false;
  })();

  const canGoNext = (() => {
    for (let i = currentIndex + 1; i < displayChars.length; i++) {
      if (isNavigable(i)) return true;
    }
    return false;
  })();

  const handleFinish = () => {
    // Immediate flush with the result summary so teacher dashboard can read it
    // directly from step_data['character-practice'].result (Issue #1549).
    onProgressChange?.(
      buildStepData({ result: { practiced_words: vocabWords, total_words: vocabWords.length } }),
      true,
    );
    onFinish({ practicedWords: vocabWords, totalWords: vocabWords.length });
  };

  if (displayChars.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface">
        <div className="text-center space-y-4 p-8">
          <p className="text-on-surface-variant">這篇課文沒有可練習的生字</p>
          <button onClick={handleFinish} className="btn-immersive">
            繼續下一步 <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
          </button>
        </div>
      </div>
    );
  }

  // Whether to show left stimulus panel (hide in round 2 = recall mode)
  const showLeftPanel = currentRound !== 2;
  // Whether RadicalDecomposition should use colorMode
  const radicalColorMode = currentRound === 1;
  // Whether to show mergeMode (brief flash when transitioning 1→2)
  const radicalMergeMode = showMergeAnimation;

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-y-auto pb-32">
      <div className="flex-1 px-6 md:px-12 pt-6">
        {/* Overall progress bar + prev/next nav */}
        <div className="max-w-6xl mx-auto mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrev}
                disabled={!canGoPrev}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high disabled:opacity-30 transition-all"
                aria-label="回到上一個已完成的字"
              >
                <span className="material-symbols-outlined text-lg">chevron_left</span>
              </button>
              <span className="text-sm font-headline font-bold text-on-surface">
                第 {currentIndex + 1} / {displayChars.length} 字
                {practicedChars.has(currentChar) && (
                  <span className="ml-1.5 text-emerald-600">✓</span>
                )}
              </span>
              <button
                onClick={handleNext}
                disabled={!canGoNext}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-high disabled:opacity-30 transition-all"
                aria-label="前往下一個已完成的字"
              >
                <span className="material-symbols-outlined text-lg">chevron_right</span>
              </button>
            </div>
            <span className="text-sm text-on-surface-variant">
              {practicedChars.size} / {displayChars.length} 字已完成
            </span>
          </div>
          <div className="h-2.5 bg-surface-container-high rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${displayChars.length > 0 ? (practicedChars.size / displayChars.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* ── Character chip strip — tap any character to jump directly ── */}
        {displayChars.length > 1 && (
          <div
            className="max-w-6xl mx-auto mb-5 -mx-1 px-1"
            role="listbox"
            aria-label="生字選擇"
          >
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {displayChars.map((ch, i) => {
                const isDone = practicedChars.has(ch);
                const isActive = i === currentIndex;
                const isUnlocked = isDone || i === unlockedIndex;
                return (
                  <button
                    key={`${ch}-${i}`}
                    role="option"
                    aria-selected={isActive}
                    aria-label={`第 ${i + 1} 字：${ch}${isDone ? '（已完成）' : i === unlockedIndex ? '（練習中）' : '（未解鎖）'}`}
                    disabled={!isUnlocked}
                    onClick={() => isUnlocked && setCurrentIndex(i)}
                    className={[
                      'flex-shrink-0 w-10 h-10 rounded-xl text-base font-bold transition-all duration-200',
                      'flex items-center justify-center relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      isActive
                        ? 'bg-accent text-white shadow-[0_4px_16px_rgba(86,74,191,0.35)] scale-105'
                        : isDone
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 hover:scale-105'
                        : isUnlocked
                        ? 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest hover:scale-105'
                        : 'bg-surface-container text-on-surface-variant opacity-35 cursor-not-allowed',
                    ].join(' ')}
                  >
                    {ch}
                    {isDone && !isActive && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                        <span className="material-symbols-outlined text-white" style={{ fontSize: '10px' }}>check</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Round indicator banner ─────────────────────────────────── */}
        {!practicedChars.has(currentChar) && (
          <div className="max-w-6xl mx-auto mb-4">
            {currentRound === 1 ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 border border-blue-200 w-fit">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
                <span className="text-sm font-medium text-blue-700">第 1 次：仿寫練習（參考左側提示）</span>
              </div>
            ) : currentRound === 2 ? (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-300 w-fit">
                <span className="w-5 h-5 rounded-full bg-amber-600 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                <span className="text-sm font-medium text-amber-700">第 2 次：再生回憶（靠記憶寫，不看提示！）</span>
              </div>
            ) : null}
          </div>
        )}

        <div className={[
          'w-full max-w-6xl mx-auto grid gap-6 items-start',
          showLeftPanel ? 'grid-cols-1 md:grid-cols-12' : 'grid-cols-1',
        ].join(' ')}>

          {/* ── Left panel: character info + radical decomposition ──── */}
          {/* Hidden in round 2 (再生回憶) */}
          {showLeftPanel && (
            <div className="md:col-span-5 lg:col-span-4 flex flex-col gap-4">
              {/* Character + zhuyin + pronunciation */}
              <div
                className="p-6 rounded-3xl bg-surface-container-lowest shadow-editorial flex items-center justify-center gap-5"
                style={{
                  fontFamily: fontForZhuyin(zhuyinActive),
                }}
              >
                <p className="text-7xl font-bold text-on-surface leading-none">{zhuyinActive ? zhuyinStr : currentChar}</p>
                <button
                  onClick={() => {
                    if (window.speechSynthesis) {
                      const u = new SpeechSynthesisUtterance(currentChar);
                      u.lang = 'zh-TW';
                      u.rate = 0.8;
                      window.speechSynthesis.speak(u);
                    }
                  }}
                  className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center hover:bg-accent/15 active:scale-[0.95] transition-all shrink-0"
                  aria-label="聽發音"
                >
                  <span className="material-symbols-outlined text-accent text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>volume_up</span>
                </button>
              </div>

              {/* Radical decomposition — inline, with colorMode in round 1 */}
              {decomp && (
                <div className="rounded-3xl bg-surface-container-low">
                  <RadicalDecomposition
                    char={currentChar}
                    colorMode={radicalColorMode}
                    mergeMode={radicalMergeMode}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Right panel: writing canvas ─────────────────────────── */}
          <div className={showLeftPanel ? 'md:col-span-7 lg:col-span-8 flex flex-col gap-4' : 'flex flex-col gap-4'}>

            {/* Round 2 recall reminder — shown above the canvas when left panel is hidden */}
            {currentRound === 2 && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4 flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5">🧠</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800">再生回憶模式</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    左側提示已收起。憑剛才的印象，試著把「{currentChar}」完整寫出來！
                  </p>
                </div>
              </div>
            )}

            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-4 md:p-6">
              <WriteCharacter
                key={`${currentChar}-round${currentRound}`}
                character={currentChar}
                onComplete={handleCharComplete}
                embedded
                // #1342 simplified two-round flow:
                //   round 1 仿寫 → one outlined practice with radical-coloured strokes
                //   round 2 再生回憶 → one no-outline practice, no aids
                practiceMode={currentRound === 2 ? 'no-outline-once' : 'outlined-once'}
                radicalColorMode={currentRound === 1}
                componentCount={decomp?.components.length ?? 2}
              />
            </div>

            {/* Skip round 2 button */}
            {currentRound === 2 && (
              <div className="flex justify-end">
                <button
                  onClick={handleSkipRecall}
                  className="text-xs text-on-surface-variant hover:text-on-surface px-3 py-1.5 rounded-full hover:bg-surface-container-high transition-all"
                >
                  跳過第 2 次練習
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Fixed bottom CTA — only show "完成練習" when all done ──── */}
      {allDone && (
        <div className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
             style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
          <div className="max-w-md mx-auto pointer-events-auto">
            {isToolboxMode() ? (
              <ToolboxCompletionActions
                onRetry={() => {
                  // Toolbox retry: wipe per-char progress and restart from first char.
                  setPracticedChars(new Set());
                  setCurrentIndex(0);
                  try { localStorage.removeItem(storageKey); } catch {}
                }}
                className="w-full"
              />
            ) : (
              <button
                onClick={handleFinish}
                className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
              >
                <span>完成練習</span>
                <span className="material-symbols-outlined text-xl">arrow_forward</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Background decoration */}
      <div className="fixed top-0 right-0 -z-10 w-96 h-96 bg-accent/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed bottom-0 left-0 -z-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />
    </div>
  );
};

export default VocabPractice;

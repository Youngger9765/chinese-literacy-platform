import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Story, ReadingAttempt, VocabResult } from '../../types';
import { hasStrokeData } from '../stroke-order/strokeData';
import WriteCharacter from '../stroke-order/WriteCharacter';
import { useZhuyin } from '../../context/ZhuyinContext';
import RadicalDecomposition from './RadicalDecomposition';
import { getDecomposition, initGeneratedDecompositions, initRadicalMeanings } from '../../data/radicals';
import { scopedStepStorageKey } from '../../services/learningStorageScope';

interface VocabPracticeProps {
  story: Story;
  attempt: ReadingAttempt | null;
  onFinish: (result: VocabResult) => void;
  onBack: () => void;
}

/* ================================================================ */
/*  Main component                                                   */
/* ================================================================ */

const VocabPractice: React.FC<VocabPracticeProps> = ({ story, attempt, onFinish, onBack }) => {
  // Load generated decomposition data
  const [decompReady, setDecompReady] = useState(false);
  useEffect(() => {
    Promise.all([initGeneratedDecompositions(), initRadicalMeanings()]).then(() => setDecompReady(true));
  }, []);

  const storageKey = scopedStepStorageKey('vocabPractice_progress_', story.id);
  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as { practicedChars: string[]; currentIndex: number };
    } catch { return null; }
  };
  const savedProgress = useRef(loadSaved());

  const [practicedChars, setPracticedChars] = useState<Set<string>>(
    () => new Set(savedProgress.current?.practicedChars ?? [])
  );
  const [currentIndex, setCurrentIndex] = useState(savedProgress.current?.currentIndex ?? 0);

  const { zhuyinActive, processZhuyin } = useZhuyin();

  // Persist progress
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        practicedChars: Array.from(practicedChars),
        currentIndex,
      }));
    } catch {}
  }, [practicedChars, currentIndex, storageKey]);

  // Characters to practice
  const displayChars = useMemo(() => {
    const suggested = (attempt?.mispronouncedWords ?? []).filter(hasStrokeData);
    if (suggested.length > 0) return suggested.slice(0, 12);
    const seen = new Set<string>();
    const optional: string[] = [];
    for (const line of story.content) {
      for (const ch of line) {
        if (/[\u4e00-\u9fa5]/.test(ch) && hasStrokeData(ch) && !seen.has(ch)) {
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

  const handleCharComplete = () => {
    setPracticedChars(prev => {
      const next = new Set(prev).add(currentChar);
      // Auto-advance to next unpracticed character (use updated set)
      const nextUnpracticed = displayChars.findIndex((ch, i) => i > currentIndex && !next.has(ch));
      if (nextUnpracticed >= 0) {
        setCurrentIndex(nextUnpracticed);
      } else if (currentIndex < displayChars.length - 1) {
        setCurrentIndex(currentIndex + 1);
      }
      return next;
    });
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

        <div className="w-full max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-6 items-start">

          {/* ── Left panel: character info + radical decomposition ──── */}
          <div className="md:col-span-5 lg:col-span-4 flex flex-col gap-4">
            {/* Character + zhuyin + pronunciation */}
            <div
              className="p-6 rounded-3xl bg-surface-container-lowest shadow-editorial flex items-center justify-center gap-5"
              style={{
                fontFamily: zhuyinActive
                  ? "'BpmfZihiSans', 'Noto Sans TC', sans-serif"
                  : undefined,
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

            {/* Radical decomposition — inline */}
            {decomp && (
              <div className="rounded-3xl bg-surface-container-low">
                <RadicalDecomposition char={currentChar} />
              </div>
            )}
          </div>

          {/* ── Right panel: writing canvas ─────────────────────────── */}
          <div className="md:col-span-7 lg:col-span-8 flex flex-col gap-4">
            <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-4 md:p-6">
              <WriteCharacter
                key={currentChar}
                character={currentChar}
                onComplete={handleCharComplete}
                embedded
              />
            </div>
          </div>
        </div>

        {/* Character selector removed — progress bar at top is sufficient */}
      </div>

      {/* ── Fixed bottom CTA — only show "完成練習" when all done ──── */}
      {allDone && (
        <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
             style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
          <div className="max-w-md mx-auto pointer-events-auto">
            <button
              onClick={handleFinish}
              className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}
            >
              <span>完成練習</span>
              <span className="material-symbols-outlined text-xl">arrow_forward</span>
            </button>
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

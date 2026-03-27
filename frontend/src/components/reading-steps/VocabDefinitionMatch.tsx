/**
 * VocabDefinitionMatch — Step Component for 語詞定義配對
 *
 * 三民學習單第三步：
 * Show vocabulary definitions on the left; student matches each definition
 * to the correct vocabulary word by clicking definition then word (or vice versa).
 *
 * Props: { story, onFinish, zhuyinActive? }
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Story, VocabItem } from '../../types';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface VocabDefinitionMatchResult {
  matchedCount: number;
  totalCount: number;
}

export interface VocabDefinitionMatchProps {
  story: Story;
  onFinish: (result: VocabDefinitionMatchResult) => void;
  zhuyinActive?: boolean;
}

type MatchPhase = 'matching' | 'done';

interface PairState {
  defIndex: number;   // index in vocab array
  matched: boolean;
  flashWrong: boolean;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

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

function NoDataFallback({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-16 text-center max-w-lg mx-auto">
      <div className="text-5xl select-none">📖</div>
      <div>
        <h3 className="text-lg font-bold text-gray-700 mb-2">本課尚無語詞定義資料</h3>
        <p className="text-sm text-gray-500 leading-relaxed">
          這篇課文目前沒有語詞定義配對資料。<br />
          教師可透過後台上傳詞彙資料，或聯絡管理員更新課文。
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

function CompletionScreen({
  matched,
  total,
  onFinish,
}: {
  matched: number;
  total: number;
  onFinish: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 px-6 py-16 text-center max-w-lg mx-auto">
      <div className="text-5xl select-none">🎉</div>
      <div>
        <h3 className="text-2xl font-black text-emerald-800 mb-1">配對完成！</h3>
        <p className="text-emerald-700 text-base">
          成功配對 <span className="font-bold">{matched}</span> / {total} 組語詞
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
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

const VocabDefinitionMatch: React.FC<VocabDefinitionMatchProps> = ({
  story,
  onFinish,
}) => {
  const storageKey = `vocabDef_progress_${story.id}`;

  // Load persisted state
  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw) as {
        phase: MatchPhase;
        matchedIndices: number[];
        attempts: number;
      };
    } catch {
      return null;
    }
  };
  const savedProgress = useRef(loadSaved());

  const vocab: VocabItem[] = story.vocabulary ?? [];
  const hasData = vocab.length > 0;

  // Shuffle word options once on mount (or restore from saved)
  const shuffledWords = useRef<number[]>(() => {
    const indices = vocab.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  });

  const [phase, setPhase] = useState<MatchPhase>(
    () => savedProgress.current?.phase ?? 'matching',
  );

  // Which definition index is currently selected (left panel)
  const [selectedDef, setSelectedDef] = useState<number | null>(null);
  // Which word index is currently selected (right panel)
  const [selectedWord, setSelectedWord] = useState<number | null>(null);

  // pairs: defIndex → matched
  const [pairs, setPairs] = useState<PairState[]>(() => {
    const saved = savedProgress.current;
    return vocab.map((_, i) => ({
      defIndex: i,
      matched: saved ? saved.matchedIndices.includes(i) : false,
      flashWrong: false,
    }));
  });

  const [attempts, setAttempts] = useState<number>(
    () => savedProgress.current?.attempts ?? 0,
  );

  const matchedCount = pairs.filter((p) => p.matched).length;

  // Persist to localStorage
  useEffect(() => {
    if (!hasData) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          phase,
          matchedIndices: pairs.filter((p) => p.matched).map((p) => p.defIndex),
          attempts,
        }),
      );
    } catch {}
  }, [phase, pairs, attempts, storageKey, hasData]);

  // Auto-advance to done when all matched
  useEffect(() => {
    if (hasData && matchedCount === vocab.length && phase === 'matching') {
      setPhase('done');
    }
  }, [matchedCount, vocab.length, phase, hasData]);

  // Flash-wrong cleanup
  const clearFlash = useCallback((defIndex: number) => {
    setTimeout(() => {
      setPairs((prev) =>
        prev.map((p) => (p.defIndex === defIndex ? { ...p, flashWrong: false } : p)),
      );
    }, 600);
  }, []);

  // Attempt a match: selectedDef must match selectedWord's vocab index
  const tryMatch = useCallback(
    (defIdx: number, wordIdx: number) => {
      setAttempts((a) => a + 1);
      if (defIdx === wordIdx) {
        // Correct
        setPairs((prev) =>
          prev.map((p) =>
            p.defIndex === defIdx ? { ...p, matched: true, flashWrong: false } : p,
          ),
        );
      } else {
        // Wrong — flash both
        setPairs((prev) =>
          prev.map((p) =>
            p.defIndex === defIdx ? { ...p, flashWrong: true } : p,
          ),
        );
        clearFlash(defIdx);
      }
      setSelectedDef(null);
      setSelectedWord(null);
    },
    [clearFlash],
  );

  const handleDefClick = useCallback(
    (defIdx: number) => {
      // Already matched — ignore
      if (pairs[defIdx]?.matched) return;

      if (selectedWord !== null) {
        // Word already selected — try to match
        tryMatch(defIdx, selectedWord);
      } else if (selectedDef === defIdx) {
        // Deselect
        setSelectedDef(null);
      } else {
        setSelectedDef(defIdx);
      }
    },
    [pairs, selectedWord, selectedDef, tryMatch],
  );

  const handleWordClick = useCallback(
    (wordIdx: number) => {
      // Already matched — ignore
      if (pairs[wordIdx]?.matched) return;

      if (selectedDef !== null) {
        // Def already selected — try to match
        tryMatch(selectedDef, wordIdx);
      } else if (selectedWord === wordIdx) {
        // Deselect
        setSelectedWord(null);
      } else {
        setSelectedWord(wordIdx);
      }
    },
    [pairs, selectedDef, selectedWord, tryMatch],
  );

  const handleFinish = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    onFinish({ matchedCount, totalCount: vocab.length });
  }, [onFinish, matchedCount, vocab.length, storageKey]);

  return (
    <div className="flex flex-col min-h-full bg-white">
      <StepHeader
        title="語詞定義配對"
        subtitle="點選左邊的定義，再點選右邊對應的語詞，完成配對"
      />

      <div className="flex-1 overflow-auto py-6">
        {!hasData ? (
          <NoDataFallback onFinish={handleFinish} />
        ) : phase === 'done' ? (
          <CompletionScreen
            matched={matchedCount}
            total={vocab.length}
            onFinish={handleFinish}
          />
        ) : (
          <MatchingExercise
            vocab={vocab}
            pairs={pairs}
            shuffledWords={shuffledWords.current}
            selectedDef={selectedDef}
            selectedWord={selectedWord}
            onDefClick={handleDefClick}
            onWordClick={handleWordClick}
            matchedCount={matchedCount}
          />
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  MatchingExercise — the interactive matching UI                     */
/* ------------------------------------------------------------------ */

interface MatchingExerciseProps {
  vocab: VocabItem[];
  pairs: PairState[];
  shuffledWords: number[];
  selectedDef: number | null;
  selectedWord: number | null;
  onDefClick: (defIdx: number) => void;
  onWordClick: (wordIdx: number) => void;
  matchedCount: number;
}

function MatchingExercise({
  vocab,
  pairs,
  shuffledWords,
  selectedDef,
  selectedWord,
  onDefClick,
  onWordClick,
  matchedCount,
}: MatchingExerciseProps) {
  return (
    <div className="max-w-3xl mx-auto px-4">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-sm text-gray-500 mb-1">
          <span>配對進度</span>
          <span className="font-medium text-amber-700">
            {matchedCount} / {vocab.length}
          </span>
        </div>
        <div className="h-2 bg-amber-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-400 rounded-full transition-all duration-500"
            style={{ width: `${(matchedCount / vocab.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Hint text */}
      <p className="text-center text-sm text-gray-400 mb-6 select-none">
        先點選左邊的「定義」，再點選右邊對應的「語詞」
      </p>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left: definitions (in original vocab order) */}
        <div className="flex flex-col gap-3">
          <h3 className="text-center text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            定義
          </h3>
          {vocab.map((item, defIdx) => {
            const pairState = pairs[defIdx];
            const isMatched = pairState?.matched ?? false;
            const isFlashWrong = pairState?.flashWrong ?? false;
            const isSelected = selectedDef === defIdx;

            let cardClass =
              'rounded-xl border-2 px-4 py-3 text-left cursor-pointer transition-all duration-200 text-sm leading-relaxed min-h-[72px] select-none ';

            if (isMatched) {
              cardClass += 'bg-emerald-50 border-emerald-400 text-emerald-800 cursor-default opacity-70';
            } else if (isFlashWrong) {
              cardClass += 'bg-red-50 border-red-400 text-red-700 animate-pulse';
            } else if (isSelected) {
              cardClass += 'bg-amber-100 border-amber-500 text-amber-900 shadow-md';
            } else {
              cardClass += 'bg-white border-gray-200 text-gray-700 hover:border-amber-300 hover:bg-amber-50';
            }

            return (
              <button
                key={defIdx}
                className={cardClass}
                onClick={() => !isMatched && onDefClick(defIdx)}
                disabled={isMatched}
                aria-pressed={isSelected}
                aria-label={`定義 ${defIdx + 1}: ${item.definition}`}
              >
                {isMatched && (
                  <span className="inline-block mr-1 text-emerald-500 font-bold">✓</span>
                )}
                {item.definition}
              </button>
            );
          })}
        </div>

        {/* Right: shuffled vocabulary words */}
        <div className="flex flex-col gap-3">
          <h3 className="text-center text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            語詞
          </h3>
          {shuffledWords.map((vocabIdx) => {
            const pairState = pairs[vocabIdx];
            const isMatched = pairState?.matched ?? false;
            const isSelected = selectedWord === vocabIdx;

            let cardClass =
              'rounded-xl border-2 px-4 py-3 text-center cursor-pointer transition-all duration-200 font-bold text-lg min-h-[72px] flex items-center justify-center select-none ';

            if (isMatched) {
              cardClass += 'bg-emerald-50 border-emerald-400 text-emerald-700 cursor-default opacity-70';
            } else if (isSelected) {
              cardClass += 'bg-amber-100 border-amber-500 text-amber-900 shadow-md';
            } else {
              cardClass += 'bg-white border-gray-200 text-gray-800 hover:border-amber-300 hover:bg-amber-50';
            }

            return (
              <button
                key={vocabIdx}
                className={cardClass}
                onClick={() => !isMatched && onWordClick(vocabIdx)}
                disabled={isMatched}
                aria-pressed={isSelected}
                aria-label={`語詞：${vocab[vocabIdx].word}`}
              >
                {isMatched && (
                  <span className="mr-1 text-emerald-500">✓</span>
                )}
                {vocab[vocabIdx].word}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default VocabDefinitionMatch;

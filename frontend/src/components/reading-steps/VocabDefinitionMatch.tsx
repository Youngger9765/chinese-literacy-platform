/**
 * VocabDefinitionMatch — Step Component for 語詞定義配對
 *
 * 三民學習單第三步：
 * Show vocabulary definitions on the left; student matches each definition
 * to the correct vocabulary word by dragging from the sticky right panel.
 *
 * Layout (desktop):
 *   Left  — scrollable definition drop-slots
 *   Right — sticky word-bank chips (never scrolls away)
 *
 * Layout (mobile):
 *   Top   — sticky word-bank chips
 *   Below — scrollable definition slots
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
  flashCorrect: boolean;
  /** vocabIdx of the word currently dropped into this slot (or null) */
  droppedWord: number | null;
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
          <p className="mt-1 text-base text-amber-700">{subtitle}</p>
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
        className="rounded-xl bg-amber-500 px-8 py-3 text-white font-semibold text-lg hover:bg-amber-600 transition-colors"
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
    <div className="flex flex-col items-center gap-8 px-6 py-16 text-center max-w-lg mx-auto animate-fade-in">
      <div className="text-7xl select-none animate-bounce-in">🎉</div>
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-10 py-6 shadow-sm">
        <h3 className="text-3xl font-black text-emerald-800 mb-2">配對完成！</h3>
        <p className="text-emerald-700 text-lg">
          成功配對
          <span className="font-black text-2xl mx-2 text-emerald-600">{matched}</span>
          / {total} 組語詞
        </p>
      </div>
      <button
        onClick={onFinish}
        className="rounded-xl bg-emerald-500 px-12 py-4 text-white font-bold hover:bg-emerald-600 active:scale-95 transition-all text-xl shadow-lg"
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
  const shuffledWords = useRef<number[]>((() => {
    const indices = vocab.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices;
  })());

  const [phase, setPhase] = useState<MatchPhase>(
    () => savedProgress.current?.phase ?? 'matching',
  );

  const [pairs, setPairs] = useState<PairState[]>(() => {
    const saved = savedProgress.current;
    return vocab.map((_, i) => ({
      defIndex: i,
      matched: saved ? saved.matchedIndices.includes(i) : false,
      flashWrong: false,
      flashCorrect: false,
      droppedWord: null,
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
      setTimeout(() => setPhase('done'), 600);
    }
  }, [matchedCount, vocab.length, phase, hasData]);

  // Flash-wrong cleanup
  const clearFlash = useCallback((defIndex: number) => {
    setTimeout(() => {
      setPairs((prev) =>
        prev.map((p) => (p.defIndex === defIndex ? { ...p, flashWrong: false } : p)),
      );
    }, 550);
  }, []);

  // Flash-correct cleanup
  const clearCorrect = useCallback((defIndex: number) => {
    setTimeout(() => {
      setPairs((prev) =>
        prev.map((p) => (p.defIndex === defIndex ? { ...p, flashCorrect: false } : p)),
      );
    }, 400);
  }, []);

  // Attempt a match: defIdx and wordIdx must be equal for a correct pair
  const tryMatch = useCallback(
    (defIdx: number, wordIdx: number) => {
      setAttempts((a) => a + 1);
      if (defIdx === wordIdx) {
        // Correct
        setPairs((prev) =>
          prev.map((p) =>
            p.defIndex === defIdx
              ? { ...p, flashCorrect: true, droppedWord: wordIdx }
              : p,
          ),
        );
        clearCorrect(defIdx);
        setTimeout(() => {
          setPairs((prev) =>
            prev.map((p) =>
              p.defIndex === defIdx
                ? { ...p, matched: true, flashCorrect: false }
                : p,
            ),
          );
        }, 300);
      } else {
        // Wrong — shake, clear dropped word
        setPairs((prev) =>
          prev.map((p) =>
            p.defIndex === defIdx
              ? { ...p, flashWrong: true, droppedWord: null }
              : p,
          ),
        );
        clearFlash(defIdx);
      }
    },
    [clearFlash, clearCorrect],
  );

  const handleFinish = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {}
    onFinish({ matchedCount, totalCount: vocab.length });
  }, [onFinish, matchedCount, vocab.length, storageKey]);

  return (
    <div className="flex flex-col min-h-full bg-amber-50">
      <StepHeader
        title="語詞定義配對"
        subtitle="從右側語詞庫拖拉語詞，放到左側對應的定義格子中"
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
          <DragMatchExercise
            vocab={vocab}
            pairs={pairs}
            shuffledWords={shuffledWords.current}
            matchedCount={matchedCount}
            onMatch={tryMatch}
            onReturnWord={(defIdx) => {
              setPairs((prev) =>
                prev.map((p) =>
                  p.defIndex === defIdx ? { ...p, droppedWord: null } : p,
                ),
              );
            }}
          />
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  DragMatchExercise — drag-and-drop layout with sticky word bank     */
/* ------------------------------------------------------------------ */

interface DragMatchExerciseProps {
  vocab: VocabItem[];
  pairs: PairState[];
  shuffledWords: number[];
  matchedCount: number;
  onMatch: (defIdx: number, wordIdx: number) => void;
  onReturnWord: (defIdx: number) => void;
}

function DragMatchExercise({
  vocab,
  pairs,
  shuffledWords,
  matchedCount,
  onMatch,
  onReturnWord,
}: DragMatchExerciseProps) {
  const pct = vocab.length > 0 ? (matchedCount / vocab.length) * 100 : 0;

  // Track which vocabIdx is currently being dragged
  const [draggingWord, setDraggingWord] = useState<number | null>(null);
  // Track which slot is being dragged over
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);

  // Set of vocabIdx words that have already been placed (matched or pending in a slot)
  const placedWords = new Set(
    pairs
      .filter((p) => p.matched || p.droppedWord !== null)
      .map((p) => (p.matched ? p.defIndex : p.droppedWord!)),
  );

  const handleDragStart = (e: React.DragEvent, wordIdx: number) => {
    setDraggingWord(wordIdx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(wordIdx));
  };

  const handleDragEnd = () => {
    setDraggingWord(null);
    setDragOverSlot(null);
  };

  const handleSlotDragOver = (e: React.DragEvent, defIdx: number) => {
    const pair = pairs[defIdx];
    if (pair?.matched) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSlot(defIdx);
  };

  const handleSlotDragLeave = () => {
    setDragOverSlot(null);
  };

  const handleSlotDrop = (e: React.DragEvent, defIdx: number) => {
    e.preventDefault();
    setDragOverSlot(null);
    const wordIdxStr = e.dataTransfer.getData('text/plain');
    const wordIdx = parseInt(wordIdxStr, 10);
    if (isNaN(wordIdx)) return;
    const pair = pairs[defIdx];
    if (pair?.matched) return;
    onMatch(defIdx, wordIdx);
  };

  // Touch-based fallback state for mobile
  const touchWordRef = useRef<number | null>(null);

  const handleWordTap = (wordIdx: number) => {
    // If tapping the already-selected word, deselect
    if (touchWordRef.current === wordIdx) {
      touchWordRef.current = null;
      setDraggingWord(null);
      return;
    }
    touchWordRef.current = wordIdx;
    setDraggingWord(wordIdx);
  };

  const handleSlotTap = (defIdx: number) => {
    const pair = pairs[defIdx];
    if (pair?.matched) return;
    if (touchWordRef.current !== null) {
      onMatch(defIdx, touchWordRef.current);
      touchWordRef.current = null;
      setDraggingWord(null);
    }
  };

  return (
    <div className="px-4 max-w-4xl mx-auto">
      {/* Progress bar */}
      <div className="mb-5 bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-base font-semibold text-gray-600">配對進度</span>
          <span className="text-lg font-black text-amber-700">
            {matchedCount}{' '}
            <span className="text-gray-400 font-normal text-sm">/ {vocab.length}</span>
          </span>
        </div>
        <div className="h-4 bg-amber-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuenow={matchedCount}
            aria-valuemin={0}
            aria-valuemax={vocab.length}
          />
        </div>
      </div>

      {/* Hint */}
      <p className="text-center text-sm text-amber-800 bg-amber-100 rounded-xl py-2 px-4 mb-5 select-none font-medium">
        從右側語詞庫拖拉語詞，放到左側對應的定義格子中
        <span className="hidden sm:inline"> · 手機模式：先點語詞，再點定義格子</span>
      </p>

      {/*
        MOBILE layout  (< md): word bank sticky at top, definitions below
        DESKTOP layout (>= md): left=definitions (scrollable area), right=word bank (sticky panel)
      */}

      {/* ── Mobile word bank — sticky top, hidden on md+ ── */}
      <div className="md:hidden sticky top-0 z-20 bg-amber-50 pb-3 pt-1 border-b border-amber-200 mb-4">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider text-center mb-2">
          語詞庫 — 點選語詞再點格子
        </h3>
        <div className="flex flex-wrap gap-2 justify-center">
          {shuffledWords.map((vocabIdx) => {
            const isUsed = placedWords.has(vocabIdx);
            const isSelected = draggingWord === vocabIdx;
            return (
              <WordChip
                key={vocabIdx}
                word={vocab[vocabIdx].word}
                isUsed={isUsed}
                isSelected={isSelected}
                isMobile
                onTap={() => !isUsed && handleWordTap(vocabIdx)}
              />
            );
          })}
        </div>
      </div>

      {/* ── Desktop two-column layout — hidden on mobile ── */}
      <div className="hidden md:flex gap-5 items-start">
        {/* Left: scrollable definitions */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <h3 className="text-center text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
            定義（拖拉語詞到格子中）
          </h3>
          {vocab.map((item, defIdx) => {
            const pairState = pairs[defIdx];
            const isMatched = pairState?.matched ?? false;
            const isFlashWrong = pairState?.flashWrong ?? false;
            const isFlashCorrect = pairState?.flashCorrect ?? false;
            const isOver = dragOverSlot === defIdx;

            return (
              <DefinitionSlot
                key={defIdx}
                definition={item.definition}
                isMatched={isMatched}
                isFlashWrong={isFlashWrong}
                isFlashCorrect={isFlashCorrect}
                isOver={isOver}
                matchedWord={
                  isMatched ? vocab[defIdx].word : null
                }
                onDragOver={(e) => handleSlotDragOver(e, defIdx)}
                onDragLeave={handleSlotDragLeave}
                onDrop={(e) => handleSlotDrop(e, defIdx)}
                onReturnWord={() => !isMatched && onReturnWord(defIdx)}
              />
            );
          })}
        </div>

        {/* Right: sticky word bank */}
        <div className="w-44 flex-shrink-0">
          <div className="sticky top-4">
            <div className="bg-white rounded-2xl shadow-md border border-amber-200 p-4">
              <h3 className="text-center text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">
                語詞庫
              </h3>
              <div className="flex flex-col gap-2">
                {shuffledWords.map((vocabIdx) => {
                  const isUsed = placedWords.has(vocabIdx);
                  const isBeingDragged = draggingWord === vocabIdx;
                  return (
                    <WordChip
                      key={vocabIdx}
                      word={vocab[vocabIdx].word}
                      isUsed={isUsed}
                      isSelected={isBeingDragged}
                      isMobile={false}
                      draggable={!isUsed}
                      onDragStart={(e) => handleDragStart(e, vocabIdx)}
                      onDragEnd={handleDragEnd}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile definition slots (shown below the sticky word bank) ── */}
      <div className="md:hidden flex flex-col gap-3 mt-2">
        <h3 className="text-center text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
          定義
        </h3>
        {vocab.map((item, defIdx) => {
          const pairState = pairs[defIdx];
          const isMatched = pairState?.matched ?? false;
          const isFlashWrong = pairState?.flashWrong ?? false;
          const isFlashCorrect = pairState?.flashCorrect ?? false;
          const isOver = dragOverSlot === defIdx;
          const tapHighlight = draggingWord !== null && !isMatched;

          return (
            <DefinitionSlot
              key={defIdx}
              definition={item.definition}
              isMatched={isMatched}
              isFlashWrong={isFlashWrong}
              isFlashCorrect={isFlashCorrect}
              isOver={isOver || tapHighlight}
              matchedWord={isMatched ? vocab[defIdx].word : null}
              onDragOver={(e) => handleSlotDragOver(e, defIdx)}
              onDragLeave={handleSlotDragLeave}
              onDrop={(e) => handleSlotDrop(e, defIdx)}
              onReturnWord={() => !isMatched && onReturnWord(defIdx)}
              onTap={() => handleSlotTap(defIdx)}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  WordChip                                                            */
/* ------------------------------------------------------------------ */

interface WordChipProps {
  word: string;
  isUsed: boolean;
  isSelected: boolean;
  isMobile: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onTap?: () => void;
}

function WordChip({
  word,
  isUsed,
  isSelected,
  isMobile,
  draggable = false,
  onDragStart,
  onDragEnd,
  onTap,
}: WordChipProps) {
  let cls =
    'rounded-xl border-2 font-bold text-lg select-none transition-all duration-200 ';

  if (isMobile) {
    cls += 'px-4 py-2 ';
  } else {
    cls += 'px-3 py-3 text-center w-full ';
  }

  if (isUsed) {
    cls += 'bg-gray-100 border-gray-200 text-gray-300 cursor-default opacity-50';
  } else if (isSelected) {
    cls +=
      'bg-indigo-100 border-[#5B4FC4] text-[#5B4FC4] shadow-md scale-105 cursor-grabbing';
  } else {
    cls +=
      'bg-white border-amber-300 text-gray-800 hover:border-[#5B4FC4] hover:bg-indigo-50 hover:shadow-sm ' +
      (draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer');
  }

  return (
    <div
      className={cls}
      draggable={draggable && !isUsed}
      onDragStart={!isUsed ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      onClick={onTap}
      role={onTap ? 'button' : undefined}
      tabIndex={onTap && !isUsed ? 0 : undefined}
      onKeyDown={
        onTap && !isUsed
          ? (e) => (e.key === 'Enter' || e.key === ' ') && onTap()
          : undefined
      }
      aria-label={`語詞：${word}${isUsed ? '（已使用）' : ''}`}
      aria-disabled={isUsed}
    >
      {word}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DefinitionSlot                                                      */
/* ------------------------------------------------------------------ */

interface DefinitionSlotProps {
  definition: string;
  isMatched: boolean;
  isFlashWrong: boolean;
  isFlashCorrect: boolean;
  isOver: boolean;
  matchedWord: string | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onReturnWord: () => void;
  onTap?: () => void;
}

function DefinitionSlot({
  definition,
  isMatched,
  isFlashWrong,
  isFlashCorrect,
  isOver,
  matchedWord,
  onDragOver,
  onDragLeave,
  onDrop,
  onReturnWord,
  onTap,
}: DefinitionSlotProps) {
  let cardCls =
    'rounded-2xl border-2 px-4 py-4 transition-all duration-200 text-base leading-relaxed min-h-[88px] select-none ';

  if (isMatched) {
    cardCls +=
      'bg-emerald-50 border-emerald-400 text-emerald-800 cursor-default';
  } else if (isFlashCorrect) {
    cardCls +=
      'bg-emerald-100 border-emerald-500 text-emerald-800 scale-105 shadow-lg';
  } else if (isFlashWrong) {
    cardCls += 'bg-red-50 border-red-400 text-red-700 animate-shake';
  } else if (isOver) {
    cardCls +=
      'bg-indigo-50 border-[#5B4FC4] text-gray-700 shadow-md scale-[1.01]';
  } else {
    cardCls +=
      'bg-white border-dashed border-gray-300 text-gray-700 hover:border-amber-300 hover:bg-amber-50 ' +
      (onTap ? 'cursor-pointer' : 'cursor-default');
  }

  return (
    <div
      className={cardCls}
      onDragOver={!isMatched ? onDragOver : undefined}
      onDragLeave={!isMatched ? onDragLeave : undefined}
      onDrop={!isMatched ? onDrop : undefined}
      onClick={onTap}
      role={onTap ? 'button' : undefined}
      tabIndex={onTap && !isMatched ? 0 : undefined}
      onKeyDown={
        onTap && !isMatched
          ? (e) => (e.key === 'Enter' || e.key === ' ') && onTap()
          : undefined
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 text-base">{definition}</div>
        <div className="flex-shrink-0 min-w-[72px]">
          {isMatched ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 text-white text-sm font-bold px-3 py-1.5">
              <span className="text-xs">✓</span>
              {matchedWord}
            </span>
          ) : (
            <span className="inline-flex items-center justify-center rounded-xl border-2 border-dashed border-gray-300 text-gray-400 text-sm px-3 py-1.5 min-w-[64px] text-center">
              拖入
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default VocabDefinitionMatch;

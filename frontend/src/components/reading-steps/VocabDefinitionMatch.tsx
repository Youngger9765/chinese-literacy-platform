/**
 * VocabDefinitionMatch — Step Component for 語詞定義配對
 *
 * 支援三種互動模式 (#697):
 *   - 選擇題 (Multiple Choice) — DEFAULT
 *   - 連連看 (Line Matching)
 *   - 拖拉配對 (Drag & Drop)
 *
 * Props: { story, onFinish, zhuyinActive? }
 */
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
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

type InteractionMode = 'multiple-choice' | 'line-match' | 'drag-drop';

/* ------------------------------------------------------------------ */
/*  Utility: shuffle                                                    */
/* ------------------------------------------------------------------ */

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                               */
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
/*  Mode Switcher                                                       */
/* ------------------------------------------------------------------ */

const MODE_LABELS: { id: InteractionMode; label: string; icon: string }[] = [
  { id: 'multiple-choice', label: '選擇題', icon: '☑' },
  { id: 'line-match', label: '連連看', icon: '↔' },
  { id: 'drag-drop', label: '拖拉配對', icon: '✥' },
];

function ModeSwitcher({
  current,
  onChange,
}: {
  current: InteractionMode;
  onChange: (m: InteractionMode) => void;
}) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 max-w-sm mx-auto">
      {MODE_LABELS.map(({ id, label, icon }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
            current === id
              ? 'bg-white text-[#5B4FC4] shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span>{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mode 1: Multiple Choice (選擇題) — DEFAULT                          */
/* ------------------------------------------------------------------ */

interface MultipleChoiceProps {
  vocab: VocabItem[];
  onAllDone: (matched: number) => void;
}

function MultipleChoiceMode({ vocab, onAllDone }: MultipleChoiceProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [matchedSoFar, setMatchedSoFar] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [wrongChoice, setWrongChoice] = useState<number | null>(null);

  // Shuffle options once per question — recompute when currentIdx changes
  const options = useMemo(() => {
    const others = vocab
      .map((_, i) => i)
      .filter((i) => i !== currentIdx);
    const distractors = shuffle(others).slice(0, 3);
    return shuffle([currentIdx, ...distractors]);
  }, [currentIdx, vocab]);

  const handleChoice = (vocabIdx: number) => {
    if (feedback !== null) return;
    if (vocabIdx === currentIdx) {
      setFeedback('correct');
      const newMatched = matchedSoFar + 1;
      setMatchedSoFar(newMatched);
      setTimeout(() => {
        setFeedback(null);
        setWrongChoice(null);
        if (currentIdx + 1 >= vocab.length) {
          onAllDone(newMatched);
        } else {
          setCurrentIdx((i) => i + 1);
        }
      }, 700);
    } else {
      setFeedback('wrong');
      setWrongChoice(vocabIdx);
      setTimeout(() => {
        setFeedback(null);
        setWrongChoice(null);
      }, 700);
    }
  };

  const item = vocab[currentIdx];

  return (
    <div className="max-w-xl mx-auto px-4">
      {/* Progress */}
      <div className="mb-5 bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-500">題目進度</span>
        <span className="text-base font-black text-amber-700">
          {currentIdx + 1}{' '}
          <span className="text-gray-400 font-normal text-sm">/ {vocab.length}</span>
        </span>
      </div>

      {/* Definition card */}
      <div className="bg-white border-2 border-[#5B4FC4] rounded-2xl p-6 mb-6 shadow-sm">
        <p className="text-xs font-semibold text-[#5B4FC4] uppercase tracking-wider mb-2">
          定義
        </p>
        <p className="text-lg text-gray-800 leading-relaxed">{item.definition}</p>
      </div>

      {/* Options */}
      <p className="text-center text-sm text-gray-500 mb-3 select-none">
        請選出對應的語詞
      </p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((vocabIdx) => {
          const isCorrect = feedback === 'correct' && vocabIdx === currentIdx;
          const isWrong = feedback === 'wrong' && vocabIdx === wrongChoice;
          const isRevealCorrect = feedback === 'wrong' && vocabIdx === currentIdx;

          let cls =
            'rounded-xl border-2 px-4 py-4 text-center font-bold text-xl transition-all duration-200 select-none ';
          if (isCorrect || isRevealCorrect) {
            cls +=
              'bg-emerald-100 border-emerald-500 text-emerald-800 scale-105 shadow-md cursor-default';
          } else if (isWrong) {
            cls += 'bg-red-50 border-red-400 text-red-700 animate-shake cursor-pointer';
          } else {
            cls +=
              'bg-white border-gray-200 text-gray-800 hover:border-[#5B4FC4] hover:bg-purple-50 hover:shadow-sm active:scale-95 cursor-pointer';
          }

          return (
            <button
              key={vocabIdx}
              className={cls}
              onClick={() => handleChoice(vocabIdx)}
              disabled={feedback !== null}
            >
              {vocab[vocabIdx].word}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mode 2: Line Match (連連看)                                         */
/* ------------------------------------------------------------------ */

interface LineMatchProps {
  vocab: VocabItem[];
  shuffledWords: number[];
  onAllDone: (matched: number) => void;
}

interface LineData {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  defIdx: number;
}

function LineMatchMode({ vocab, shuffledWords, onAllDone }: LineMatchProps) {
  const [selectedDef, setSelectedDef] = useState<number | null>(null);
  const [selectedWord, setSelectedWord] = useState<number | null>(null);
  // defIdx -> shufflePos of matched word
  const [matchedMap, setMatchedMap] = useState<Map<number, number>>(new Map());
  const [flashWrong, setFlashWrong] = useState<number | null>(null);
  const [flashCorrectDef, setFlashCorrectDef] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const defRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wordRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [lines, setLines] = useState<LineData[]>([]);

  const matchedCount = matchedMap.size;

  const computeLines = useCallback(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newLines: LineData[] = [];
    matchedMap.forEach((shufflePos, defIdx) => {
      const defEl = defRefs.current[defIdx];
      const wordEl = wordRefs.current[shufflePos];
      if (!defEl || !wordEl) return;
      const dr = defEl.getBoundingClientRect();
      const wr = wordEl.getBoundingClientRect();
      newLines.push({
        x1: dr.right - containerRect.left,
        y1: dr.top + dr.height / 2 - containerRect.top,
        x2: wr.left - containerRect.left,
        y2: wr.top + wr.height / 2 - containerRect.top,
        defIdx,
      });
    });
    setLines(newLines);
  }, [matchedMap]);

  useEffect(() => {
    computeLines();
  }, [computeLines]);

  useEffect(() => {
    const handleResize = () => computeLines();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [computeLines]);

  const attemptMatch = useCallback(
    (defIdx: number, shufflePos: number) => {
      const vocabIdx = shuffledWords[shufflePos];
      if (vocabIdx === defIdx) {
        setFlashCorrectDef(defIdx);
        setTimeout(() => setFlashCorrectDef(null), 500);
        setMatchedMap((prev) => {
          const next = new Map(prev);
          next.set(defIdx, shufflePos);
          if (next.size === vocab.length) {
            setTimeout(() => onAllDone(next.size), 600);
          }
          return next;
        });
      } else {
        setFlashWrong(defIdx);
        setTimeout(() => setFlashWrong(null), 550);
      }
      setSelectedDef(null);
      setSelectedWord(null);
    },
    [shuffledWords, vocab.length, onAllDone],
  );

  const handleDefClick = (defIdx: number) => {
    if (matchedMap.has(defIdx)) return;
    if (selectedWord !== null) {
      attemptMatch(defIdx, selectedWord);
    } else {
      setSelectedDef(selectedDef === defIdx ? null : defIdx);
    }
  };

  const handleWordClick = (shufflePos: number) => {
    const vocabIdx = shuffledWords[shufflePos];
    if (matchedMap.has(vocabIdx)) return;
    if (selectedDef !== null) {
      attemptMatch(selectedDef, shufflePos);
    } else {
      setSelectedWord(selectedWord === shufflePos ? null : shufflePos);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4">
      {/* Progress */}
      <div className="mb-5 bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-500">配對進度</span>
        <span className="text-base font-black text-amber-700">
          {matchedCount}{' '}
          <span className="text-gray-400 font-normal text-sm">/ {vocab.length}</span>
        </span>
      </div>

      <p className="text-center text-sm text-amber-800 bg-amber-100 rounded-xl py-2 px-4 mb-4 select-none font-medium">
        點選左邊的定義，再點選右邊對應的語詞連線
      </p>

      {/* Relative container for SVG line overlay */}
      <div className="relative" ref={containerRef}>
        {/* SVG lines overlay */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{ width: '100%', height: '100%', overflow: 'visible' }}
        >
          {lines.map(({ x1, y1, x2, y2, defIdx }) => (
            <line
              key={defIdx}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#10b981"
              strokeWidth={3}
              strokeLinecap="round"
              opacity={0.85}
            />
          ))}
        </svg>

        <div className="grid grid-cols-2 gap-8">
          {/* Left: definitions */}
          <div className="flex flex-col gap-3">
            <h3 className="text-center text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
              定義
            </h3>
            {vocab.map((item, defIdx) => {
              const isMatched = matchedMap.has(defIdx);
              const isSelected = selectedDef === defIdx;
              const isWrong = flashWrong === defIdx;
              const isCorrect = flashCorrectDef === defIdx;

              let cls =
                'rounded-2xl border-2 px-4 py-4 text-left text-sm leading-relaxed min-h-[72px] select-none transition-all duration-200 w-full ';
              if (isMatched) {
                cls +=
                  'bg-emerald-50 border-emerald-400 text-emerald-800 cursor-default';
              } else if (isCorrect) {
                cls +=
                  'bg-emerald-100 border-emerald-500 text-emerald-800 scale-[1.02] shadow-md cursor-pointer';
              } else if (isWrong) {
                cls +=
                  'bg-red-50 border-red-400 text-red-700 animate-shake cursor-pointer';
              } else if (isSelected) {
                cls +=
                  'bg-purple-100 border-[#5B4FC4] text-purple-900 shadow-md scale-[1.02] cursor-pointer';
              } else {
                cls +=
                  'bg-white border-gray-200 text-gray-700 hover:border-[#5B4FC4] hover:bg-purple-50 cursor-pointer';
              }

              return (
                <button
                  key={defIdx}
                  ref={(el) => {
                    defRefs.current[defIdx] = el;
                  }}
                  className={cls}
                  onClick={() => !isMatched && handleDefClick(defIdx)}
                  disabled={isMatched}
                >
                  {isMatched && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-xs font-bold mr-2 flex-shrink-0">
                      ✓
                    </span>
                  )}
                  {item.definition}
                </button>
              );
            })}
          </div>

          {/* Right: shuffled words */}
          <div className="flex flex-col gap-3">
            <h3 className="text-center text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
              語詞
            </h3>
            {shuffledWords.map((vocabIdx, shufflePos) => {
              const isMatched = matchedMap.has(vocabIdx);
              const isSelected = selectedWord === shufflePos;

              let cls =
                'rounded-2xl border-2 px-4 py-4 text-center font-bold text-xl min-h-[72px] flex items-center justify-center select-none transition-all duration-200 ';
              if (isMatched) {
                cls +=
                  'bg-emerald-50 border-emerald-400 text-emerald-700 cursor-default';
              } else if (isSelected) {
                cls +=
                  'bg-purple-100 border-[#5B4FC4] text-purple-900 shadow-md scale-[1.02] cursor-pointer';
              } else {
                cls +=
                  'bg-white border-gray-200 text-gray-800 hover:border-[#5B4FC4] hover:bg-purple-50 cursor-pointer';
              }

              return (
                <button
                  key={shufflePos}
                  ref={(el) => {
                    wordRefs.current[shufflePos] = el;
                  }}
                  className={cls}
                  onClick={() => !isMatched && handleWordClick(shufflePos)}
                  disabled={isMatched}
                >
                  {isMatched && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-xs font-bold mr-2 flex-shrink-0">
                      ✓
                    </span>
                  )}
                  {vocab[vocabIdx].word}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mode 3: Drag & Drop (拖拉配對)                                      */
/* ------------------------------------------------------------------ */

interface DragDropProps {
  vocab: VocabItem[];
  shuffledWords: number[];
  onAllDone: (matched: number) => void;
}

function DragDropMode({ vocab, shuffledWords, onAllDone }: DragDropProps) {
  // dragging: which vocabIdx is being dragged
  const [draggingVocabIdx, setDraggingVocabIdx] = useState<number | null>(null);
  // placements: defIdx -> vocabIdx (tentative, may be wrong or correct)
  const [placements, setPlacements] = useState<Map<number, number>>(new Map());
  // confirmed: set of defIdx that are correctly placed
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  // wrongFlash: set of defIdx currently flashing red
  const [wrongFlash, setWrongFlash] = useState<Set<number>>(new Set());
  // hoverTarget: defIdx being dragged over
  const [hoverTarget, setHoverTarget] = useState<number | null>(null);
  // touchSelected: vocabIdx selected via tap (for mobile)
  const [touchSelected, setTouchSelected] = useState<number | null>(null);

  const attemptPlace = useCallback(
    (defIdx: number, vocabIdx: number) => {
      if (confirmed.has(defIdx)) return;

      setPlacements((prev) => {
        const next = new Map(prev);
        // Remove this vocabIdx from any previous slot
        for (const [k, v] of next.entries()) {
          if (v === vocabIdx) next.delete(k);
        }
        next.set(defIdx, vocabIdx);
        return next;
      });

      if (vocabIdx === defIdx) {
        // Correct
        setConfirmed((prev) => {
          const next = new Set(prev);
          next.add(defIdx);
          if (next.size === vocab.length) {
            setTimeout(() => onAllDone(next.size), 600);
          }
          return next;
        });
      } else {
        // Wrong — flash then bounce back
        setWrongFlash((prev) => new Set([...prev, defIdx]));
        setTimeout(() => {
          setPlacements((prev) => {
            const next = new Map(prev);
            next.delete(defIdx);
            return next;
          });
          setWrongFlash((prev) => {
            const next = new Set(prev);
            next.delete(defIdx);
            return next;
          });
        }, 650);
      }
    },
    [confirmed, vocab.length, onAllDone],
  );

  const handleDragStart = (vocabIdx: number) => {
    setDraggingVocabIdx(vocabIdx);
    setTouchSelected(null);
  };
  const handleDragEnd = () => {
    setDraggingVocabIdx(null);
    setHoverTarget(null);
  };
  const handleDrop = (defIdx: number) => {
    if (draggingVocabIdx === null) return;
    setHoverTarget(null);
    attemptPlace(defIdx, draggingVocabIdx);
    setDraggingVocabIdx(null);
  };

  // Touch / tap flow: tap word → select; tap slot → place
  const handleTouchStart = (vocabIdx: number) => {
    if (confirmed.has(vocabIdx)) return;
    setTouchSelected((prev) => (prev === vocabIdx ? null : vocabIdx));
  };
  const handleSlotTap = (defIdx: number) => {
    if (touchSelected !== null) {
      attemptPlace(defIdx, touchSelected);
      setTouchSelected(null);
    }
  };

  // Which vocabIdx are in confirmed/pending placements (not bouncing back)
  const placedVocabIdxSet = useMemo(() => {
    const s = new Set<number>();
    placements.forEach((vocabIdx, defIdx) => {
      if (!wrongFlash.has(defIdx)) s.add(vocabIdx);
    });
    return s;
  }, [placements, wrongFlash]);

  return (
    <div className="max-w-xl mx-auto px-4">
      {/* Progress */}
      <div className="mb-5 bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-500">配對進度</span>
        <span className="text-base font-black text-amber-700">
          {confirmed.size}{' '}
          <span className="text-gray-400 font-normal text-sm">/ {vocab.length}</span>
        </span>
      </div>

      <p className="text-center text-sm text-amber-800 bg-amber-100 rounded-xl py-2 px-4 mb-4 select-none font-medium">
        拖拉語詞卡片到對應的定義欄位，手機可先點選語詞再點選欄位
      </p>

      {/* Word bank */}
      <div className="mb-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 text-center">
          語詞庫
        </p>
        <div className="flex flex-wrap gap-2 justify-center min-h-[56px] bg-gray-50 rounded-xl p-3 border border-gray-200">
          {shuffledWords.map((vocabIdx) => {
            const isPlaced = placedVocabIdxSet.has(vocabIdx);
            if (isPlaced) return null;

            const isDragging = draggingVocabIdx === vocabIdx;
            const isTouchSelected = touchSelected === vocabIdx;

            let cls =
              'rounded-xl border-2 px-5 py-3 text-center font-bold text-xl select-none transition-all duration-200 ';
            if (isDragging) {
              cls +=
                'border-[#5B4FC4] bg-purple-100 text-purple-900 shadow-xl scale-105 opacity-80 cursor-grabbing';
            } else if (isTouchSelected) {
              cls +=
                'border-[#5B4FC4] bg-purple-100 text-purple-900 shadow-md scale-105 cursor-pointer';
            } else {
              cls +=
                'border-gray-200 bg-white text-gray-800 hover:border-[#5B4FC4] hover:bg-purple-50 hover:shadow-sm active:scale-95 cursor-grab';
            }

            return (
              <div
                key={vocabIdx}
                draggable
                onDragStart={() => handleDragStart(vocabIdx)}
                onDragEnd={handleDragEnd}
                onTouchStart={() => handleTouchStart(vocabIdx)}
                onClick={() => handleTouchStart(vocabIdx)}
                className={cls}
              >
                {vocab[vocabIdx].word}
              </div>
            );
          })}
        </div>
        {touchSelected !== null && (
          <p className="text-center text-xs text-[#5B4FC4] mt-2 font-medium">
            已選「{vocab[touchSelected].word}」— 點選下方欄位放入
          </p>
        )}
      </div>

      {/* Definition slots */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 text-center">
          定義欄位
        </p>
        {vocab.map((item, defIdx) => {
          const placedVocabIdx = placements.get(defIdx) ?? null;
          const isCorrect = confirmed.has(defIdx);
          const isWrong = wrongFlash.has(defIdx);
          const isOver = hoverTarget === defIdx && !isCorrect;

          let cls =
            'rounded-2xl border-2 px-4 py-4 min-h-[80px] flex flex-col gap-2 transition-all duration-200 cursor-pointer ';
          if (isCorrect) {
            cls += 'bg-emerald-50 border-emerald-400 cursor-default';
          } else if (isWrong) {
            cls += 'bg-red-50 border-red-400 animate-shake';
          } else if (isOver) {
            cls += 'bg-purple-50 border-[#5B4FC4] scale-[1.01] shadow-md';
          } else if (placedVocabIdx !== null) {
            cls += 'bg-amber-50 border-amber-400';
          } else {
            cls += 'bg-white border-dashed border-gray-300 hover:border-[#5B4FC4]';
          }

          return (
            <div
              key={defIdx}
              className={cls}
              onDragOver={(e) => {
                e.preventDefault();
                if (!isCorrect) setHoverTarget(defIdx);
              }}
              onDragLeave={() => setHoverTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(defIdx);
              }}
              onClick={() => handleSlotTap(defIdx)}
            >
              <p className="text-sm text-gray-700 leading-relaxed">{item.definition}</p>
              <div className="flex items-center justify-center h-8">
                {isCorrect ? (
                  <span className="font-bold text-base text-emerald-700 flex items-center gap-1">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold">
                      ✓
                    </span>
                    {placedVocabIdx !== null ? vocab[placedVocabIdx].word : ''}
                  </span>
                ) : placedVocabIdx !== null ? (
                  <span className="font-bold text-base text-amber-800">
                    {vocab[placedVocabIdx].word}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 select-none">
                    拖拉語詞到這裡
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
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
  const storageModeKey = `vocabDef_mode_${story.id}`;
  const vocab: VocabItem[] = story.vocabulary ?? [];
  const hasData = vocab.length > 0;

  const [mode, setMode] = useState<InteractionMode>(() => {
    try {
      const saved = localStorage.getItem(storageModeKey) as InteractionMode | null;
      if (
        saved &&
        ['multiple-choice', 'line-match', 'drag-drop'].includes(saved)
      ) {
        return saved;
      }
    } catch {}
    return 'multiple-choice';
  });

  const [isDone, setIsDone] = useState(false);
  const [matchedCount, setMatchedCount] = useState(0);
  // Increment to force-remount the active mode on mode change
  const [modeKey, setModeKey] = useState(0);

  // Stable shuffled word order shared between line-match and drag-drop
  const shuffledWords = useRef<number[]>(shuffle(vocab.map((_, i) => i)));

  const handleModeChange = (m: InteractionMode) => {
    setMode(m);
    setIsDone(false);
    setMatchedCount(0);
    setModeKey((k) => k + 1);
    try {
      localStorage.setItem(storageModeKey, m);
    } catch {}
  };

  const handleAllDone = useCallback((matched: number) => {
    setMatchedCount(matched);
    setIsDone(true);
  }, []);

  const handleFinish = useCallback(() => {
    try {
      localStorage.removeItem(storageModeKey);
    } catch {}
    onFinish({ matchedCount, totalCount: vocab.length });
  }, [onFinish, matchedCount, vocab.length, storageModeKey]);

  const modeSubtitles: Record<InteractionMode, string> = {
    'multiple-choice': '看定義，選出對應的語詞',
    'line-match': '點選左邊定義，再點選右邊對應語詞連線',
    'drag-drop': '拖拉語詞卡片到對應的定義欄位',
  };

  return (
    <div className="flex flex-col min-h-full bg-amber-50">
      <StepHeader title="語詞定義配對" subtitle={modeSubtitles[mode]} />

      <div className="flex-1 overflow-auto py-6">
        {!hasData ? (
          <NoDataFallback onFinish={handleFinish} />
        ) : isDone ? (
          <CompletionScreen
            matched={matchedCount}
            total={vocab.length}
            onFinish={handleFinish}
          />
        ) : (
          <>
            <ModeSwitcher current={mode} onChange={handleModeChange} />

            {mode === 'multiple-choice' && (
              <MultipleChoiceMode
                key={`mc-${modeKey}`}
                vocab={vocab}
                onAllDone={handleAllDone}
              />
            )}
            {mode === 'line-match' && (
              <LineMatchMode
                key={`lm-${modeKey}`}
                vocab={vocab}
                shuffledWords={shuffledWords.current}
                onAllDone={handleAllDone}
              />
            )}
            {mode === 'drag-drop' && (
              <DragDropMode
                key={`dd-${modeKey}`}
                vocab={vocab}
                shuffledWords={shuffledWords.current}
                onAllDone={handleAllDone}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default VocabDefinitionMatch;

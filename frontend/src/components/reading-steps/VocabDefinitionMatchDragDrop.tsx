/**
 * DragDropMode — Drag & Drop interaction mode for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx. Stateful UI component (drag/touch state).
 * Uses AnswerRecord type from logic module.
 *
 * Fix #1101 (炮灰選項): confirmed words shown as locked/dimmed in word bank so the
 * last drag-drop question always has multiple options — no forced-correct final question.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VocabItem } from '../../types';
import { AnswerRecord } from './vocabDefinitionMatchLogic';

export interface DragDropProps {
  vocab: VocabItem[];
  activeDefIndices: number[];
  shuffledWords: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
}

export function DragDropMode({ vocab, activeDefIndices, shuffledWords, onAllDone }: DragDropProps) {
  const [draggingVocabIdx, setDraggingVocabIdx] = useState<number | null>(null);
  const [placements, setPlacements] = useState<Map<number, number>>(new Map());
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [wrongFlash, setWrongFlash] = useState<Set<number>>(new Set());
  const [hoverTarget, setHoverTarget] = useState<number | null>(null);
  const [touchSelected, setTouchSelected] = useState<number | null>(null);
  // vocabIdx values currently playing the fly-away exit animation
  const [flyingAway, setFlyingAway] = useState<Set<number>>(new Set());

  // Track last answer per slot for summary (correct ones only, since wrong bounce back)
  const answersRef = useRef<AnswerRecord[]>(
    activeDefIndices.map((defIdx) => ({ defIndex: defIdx, answeredWordIdx: null, correct: null })),
  );

  const confirmedRef = useRef<Set<number>>(new Set());
  const wrongAttemptCountRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    setDraggingVocabIdx(null);
    setPlacements(new Map());
    setConfirmed(new Set());
    setWrongFlash(new Set());
    setHoverTarget(null);
    setTouchSelected(null);
    setFlyingAway(new Set());
    answersRef.current = activeDefIndices.map((defIdx) => ({
      defIndex: defIdx,
      answeredWordIdx: null,
      correct: null,
      wrongAttempts: 0,
    }));
    confirmedRef.current = new Set();
    wrongAttemptCountRef.current = new Map();
  }, [activeDefIndices, shuffledWords]);

  const attemptPlace = useCallback(
    (defIdx: number, vocabIdx: number) => {
      if (confirmedRef.current.has(defIdx)) return;

      setPlacements((prev) => {
        const next = new Map(prev);
        for (const [k, v] of next.entries()) {
          if (v === vocabIdx) next.delete(k);
        }
        next.set(defIdx, vocabIdx);
        return next;
      });

      if (vocabIdx === defIdx) {
        // Correct — trigger fly-away animation on the word chip, then mark confirmed
        const wrongAttempts = wrongAttemptCountRef.current.get(defIdx) ?? 0;
        answersRef.current = answersRef.current.map((a) =>
          a.defIndex === defIdx ? {
            ...a,
            answeredWordIdx: vocabIdx,
            correct: true,
            wrongAttempts,
          } : a,
        );
        confirmedRef.current = new Set([...confirmedRef.current, defIdx]);

        // Start fly-away animation on the chip
        setFlyingAway((prev) => new Set([...prev, vocabIdx]));
        // After animation completes, mark the slot as confirmed (chip is now hidden)
        setTimeout(() => {
          setFlyingAway((prev) => {
            const next = new Set(prev);
            next.delete(vocabIdx);
            return next;
          });
          setConfirmed((prev) => {
            const next = new Set(prev);
            next.add(defIdx);
            if (next.size === activeDefIndices.length) {
              setTimeout(() => onAllDone(answersRef.current), 600);
            }
            return next;
          });
        }, 550);
      } else {
        // Wrong — record attempt, flash, bounce back
        const wrongAttempts = (wrongAttemptCountRef.current.get(defIdx) ?? 0) + 1;
        wrongAttemptCountRef.current.set(defIdx, wrongAttempts);
        answersRef.current = answersRef.current.map((a) =>
          a.defIndex === defIdx ? {
            ...a,
            answeredWordIdx: vocabIdx,
            correct: false,
            wrongAttempts,
          } : a,
        );
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
    [activeDefIndices.length, onAllDone],
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

  const placedVocabIdxSet = useMemo(() => {
    const s = new Set<number>();
    placements.forEach((vocabIdx, defIdx) => {
      if (!wrongFlash.has(defIdx)) s.add(vocabIdx);
    });
    return s;
  }, [placements, wrongFlash]);

  const activeShuffledWords = shuffledWords.filter((wi) => activeDefIndices.includes(wi));

  /* ---- Word bank chips (shared between mobile top strip and desktop right panel) ---- */
  const wordBankContent = (
    <>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-on-surface-variant text-lg">dictionary</span>
        <span className="text-sm font-headline font-bold text-on-surface-variant uppercase tracking-wider">語詞庫</span>
      </div>
      <div className="flex flex-wrap gap-2 min-h-[56px]">
        {activeShuffledWords.map((vocabIdx) => {
          const isPlaced = placedVocabIdxSet.has(vocabIdx);
          const isFlying = flyingAway.has(vocabIdx);
          // Fix #1101 (炮灰選項): Keep correctly-confirmed words visible as locked
          // "cannon fodder" chips so the last drag-drop question always has multiple
          // options in the bank — no more forced-correct final question.
          const isConfirmedWord = confirmed.has(vocabIdx);

          const isDragging = draggingVocabIdx === vocabIdx;
          const isTouchSelected = touchSelected === vocabIdx;

          // Confirmed words (fly-away animation already finished): show as locked/dimmed
          if (isConfirmedWord && !isFlying) {
            return (
              <div
                key={vocabIdx}
                className="rounded-2xl border-2 px-4 py-2.5 text-center font-bold text-base select-none border-emerald-200 bg-emerald-50 text-emerald-400 cursor-not-allowed opacity-60 line-through"
                aria-label={`${vocab[vocabIdx]?.word} 已配對`}
              >
                {vocab[vocabIdx]?.word}
              </div>
            );
          }

          // Placed but not yet confirmed (pending validation — bounce-back in progress).
          // Fly-away in progress (#1102) still needs to render its animation chip.
          if (isPlaced && !isFlying) return null;

          let cls =
            'rounded-2xl border-2 px-4 py-2.5 text-center font-bold text-base select-none transition-all duration-200 ';
          if (isFlying) {
            cls += 'border-emerald-400 bg-emerald-100 text-emerald-700 animate-fly-away pointer-events-none';
          } else if (isDragging) {
            cls += 'border-accent bg-accent/10 text-accent shadow-xl scale-105 opacity-80 cursor-grabbing';
          } else if (isTouchSelected) {
            cls += 'border-accent bg-accent/10 text-accent shadow-md scale-105 cursor-pointer';
          } else {
            cls += 'border-surface-container-high bg-surface-container-lowest text-on-surface hover:border-accent hover:bg-accent/5 active:scale-95 cursor-grab';
          }

          return (
            <div
              key={vocabIdx}
              draggable={!isFlying}
              onDragStart={() => !isFlying && handleDragStart(vocabIdx)}
              onDragEnd={handleDragEnd}
              onTouchStart={() => !isFlying && handleTouchStart(vocabIdx)}
              onClick={() => !isFlying && handleTouchStart(vocabIdx)}
              className={cls}
            >
              {vocab[vocabIdx]?.word}
            </div>
          );
        })}
      </div>
      {touchSelected !== null && (
        <p className="text-center text-xs text-accent mt-2 font-medium">
          已選「{vocab[touchSelected]?.word}」— 點選下方欄位放入
        </p>
      )}
    </>
  );

  /* ---- Definition slots ---- */
  // Sort: unmatched slots first so remaining options stay near the top as pairs are confirmed
  const sortedDefIndices = useMemo(
    () => [...activeDefIndices].sort((a, b) => {
      const aConfirmed = confirmed.has(a) ? 1 : 0;
      const bConfirmed = confirmed.has(b) ? 1 : 0;
      return aConfirmed - bConfirmed;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDefIndices, confirmed.size],
  );

  const definitionSlots = sortedDefIndices.map((defIdx) => {
    const item = vocab[defIdx];
    const placedVocabIdx = placements.get(defIdx) ?? null;
    const isCorrect = confirmed.has(defIdx);
    const isWrong = wrongFlash.has(defIdx);
    const isOver = hoverTarget === defIdx && !isCorrect;

    let cls =
      'rounded-3xl border-2 px-5 py-5 min-h-[80px] flex flex-col gap-2 transition-all duration-200 cursor-pointer ';
    if (isCorrect) {
      cls += 'bg-emerald-50 border-emerald-400 cursor-default';
    } else if (isWrong) {
      cls += 'bg-tertiary-container/10 border-tertiary animate-shake';
    } else if (isOver) {
      cls += 'bg-accent/5 border-accent scale-[1.01] shadow-md';
    } else if (placedVocabIdx !== null) {
      cls += 'bg-accent/5 border-accent/40';
    } else {
      cls += 'bg-surface-container-lowest border-dashed border-on-surface-variant/20 hover:border-accent shadow-editorial';
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
        <p className="text-base text-on-surface leading-relaxed">{item?.definition}</p>
        <div className="flex items-center justify-center h-8">
          {isCorrect ? (
            <span className="font-bold text-base text-emerald-700 flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold">
                ✓
              </span>
              {placedVocabIdx !== null ? vocab[placedVocabIdx]?.word : ''}
            </span>
          ) : placedVocabIdx !== null ? (
            <span className="font-bold text-base text-amber-800">
              {vocab[placedVocabIdx]?.word}
            </span>
          ) : (
            <span className="text-xs text-on-surface-variant/40 select-none">
              拖拉語詞到這裡
            </span>
          )}
        </div>
      </div>
    );
  });

  return (
    <div className="px-4 md:px-6 max-w-5xl mx-auto">
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2.5 bg-surface-container-high rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
            style={{ width: `${activeDefIndices.length > 0 ? (confirmed.size / activeDefIndices.length) * 100 : 0}%` }} />
        </div>
        <span className="text-sm font-headline font-bold text-on-surface-variant shrink-0">
          {confirmed.size} / {activeDefIndices.length}
        </span>
      </div>

      {/* Mobile: word bank on top (sticky so it stays visible while scrolling definitions) */}
      <div className="md:hidden sticky top-0 z-10 bg-surface pb-3 pt-1">
        {wordBankContent}
      </div>

      {/* Desktop: two-column layout — definitions left (scrollable), word bank right (sticky) */}
      <div className="md:flex md:gap-6 md:items-start md:max-h-[calc(100vh-16rem)]">
        {/* Left column — definition slots, independently scrollable on desktop */}
        <div className="flex-1 min-w-0 md:overflow-y-auto md:max-h-[calc(100vh-16rem)]">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 text-center md:text-left">
            定義欄位
          </p>
          <div className="flex flex-col gap-3">
            {definitionSlots}
          </div>
        </div>

        {/* Right column — word bank panel, independently scrollable on desktop */}
        <div className="hidden md:flex md:flex-col w-52 flex-shrink-0 overflow-y-auto max-h-[calc(100vh-16rem)]">
          {wordBankContent}
        </div>
      </div>
    </div>
  );
}

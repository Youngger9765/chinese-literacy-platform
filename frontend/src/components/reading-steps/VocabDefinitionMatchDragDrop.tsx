/**
 * DragDropMode — Drag & Drop interaction mode for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx. Stateful UI component (drag/touch state).
 * Uses AnswerRecord type from logic module.
 *
 * Fix #1101 (炮灰選項): confirmed words shown as locked/dimmed in word bank so the
 * last drag-drop question always has multiple options — no forced-correct final question.
 *
 * Fix #2082 (A6/A7/A8): verbal feedback, larger definition text, device-aware instruction.
 * Issue #2163: OnboardingCoach — first-use amber說明框 + guided drag demo on real UI.
 * Issue #2135: zhuyin display on word bank chips.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VocabItem } from '../../types';
import { AnswerRecord } from './vocabDefinitionMatchLogic';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';

// A8: Detect touch (coarse pointer) vs mouse at mount time.
// Using a module-level constant so it is evaluated once and shared across renders.
const IS_TOUCH_DEVICE =
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

// ── localStorage key for first-use onboarding gate ────────────────────────
const VOCAB_DRAGDROP_ONBOARDED_KEY = 'vocab_dragdrop_onboarded';

// ── Onboarding coach — amber box, matches VocabDefinitionMatchMCQ pattern ──
interface OnboardingCoachProps {
  onDismiss: () => void;
  onDemo: () => void;
}

function DemoBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex justify-center mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-xl bg-accent text-white px-4 py-2 text-sm font-bold shadow-lg text-center max-w-xs">
        {children}
        <span
          className="absolute left-1/2 -bottom-1.5 h-3 w-3 -translate-x-1/2 rotate-45 bg-accent"
          aria-hidden
        />
      </div>
    </div>
  );
}

type DragDemoStep = 'pick-word' | 'dragging' | 'dropped' | 'success';

interface DragDemoRuntime {
  step: DragDemoStep;
  wordIdx: number;
  slotIdx: number;
}

interface DragDemoGhost {
  word: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  width: number;
  height: number;
  moving: boolean;
}

function OnboardingCoach({ onDismiss, onDemo }: OnboardingCoachProps) {
  const instruction = IS_TOUCH_DEVICE
    ? '點選上方語詞，再點下方解釋框放入'
    : '把右邊的語詞拖到左邊正確的解釋上';
  return (
    <div className="mb-5 rounded-2xl border-2 border-amber-400/60 bg-amber-50 px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-500 text-2xl flex-shrink-0 mt-0.5">
          lightbulb
        </span>
        <div className="flex-1">
          <p className="font-bold text-on-surface text-base mb-1">詞語配對怎麼玩？</p>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            {instruction}。配對正確後語詞會消失。
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 self-end">
        <button
          type="button"
          onClick={onDemo}
          className="px-4 py-2 rounded-full text-sm font-bold border-2 border-accent text-accent hover:bg-accent/10 active:scale-[0.98] transition-all"
        >
          示範
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-5 py-2 rounded-full text-sm font-bold text-white bg-accent hover:brightness-110 active:scale-[0.98] transition-all"
        >
          我知道了
        </button>
      </div>
    </div>
  );
}

export interface DragDropProps {
  vocab: VocabItem[];
  activeDefIndices: number[];
  shuffledWords: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
}

export function DragDropMode({ vocab, activeDefIndices, shuffledWords, onAllDone }: DragDropProps) {
  // #2135: zhuyin support — read context directly (same pattern as VocabDefinitionMatch.tsx)
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const zhuyinFont = fontForZhuyin(zhuyinActive);

  const [draggingVocabIdx, setDraggingVocabIdx] = useState<number | null>(null);
  const [placements, setPlacements] = useState<Map<number, number>>(new Map());
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [wrongFlash, setWrongFlash] = useState<Set<number>>(new Set());
  const [hoverTarget, setHoverTarget] = useState<number | null>(null);
  const [touchSelected, setTouchSelected] = useState<number | null>(null);
  // vocabIdx values currently playing the fly-away exit animation
  const [flyingAway, setFlyingAway] = useState<Set<number>>(new Set());

  // A6: verbal feedback state — show praise on correct, "再試試看！" on wrong
  const [wrongFeedbackSlot, setWrongFeedbackSlot] = useState<number | null>(null);
  const [correctFeedbackSlot, setCorrectFeedbackSlot] = useState<number | null>(null);

  // Onboarding state — gated by localStorage
  const [showCoach, setShowCoach] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(VOCAB_DRAGDROP_ONBOARDED_KEY);
    } catch {
      return true;
    }
  });

  // Guided demo — ghost chip flies from word bank to matching slot
  const [demo, setDemo] = useState<DragDemoRuntime | null>(null);
  const [demoGhost, setDemoGhost] = useState<DragDemoGhost | null>(null);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wordChipRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const slotRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const clearDemoTimers = useCallback(() => {
    demoTimersRef.current.forEach((id) => clearTimeout(id));
    demoTimersRef.current = [];
  }, []);

  const scheduleDemoStep = useCallback((fn: () => void, delayMs: number) => {
    const id = setTimeout(fn, delayMs);
    demoTimersRef.current.push(id);
    return id;
  }, []);

  useEffect(() => () => clearDemoTimers(), [clearDemoTimers]);

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
    setWrongFeedbackSlot(null);
    setCorrectFeedbackSlot(null);
    answersRef.current = activeDefIndices.map((defIdx) => ({
      defIndex: defIdx,
      answeredWordIdx: null,
      correct: null,
      wrongAttempts: 0,
    }));
    confirmedRef.current = new Set();
    wrongAttemptCountRef.current = new Map();
  }, [activeDefIndices, shuffledWords]);

  const handleDismissCoach = () => {
    setShowCoach(false);
    try {
      localStorage.setItem(VOCAB_DRAGDROP_ONBOARDED_KEY, '1');
    } catch {
      // ignore
    }
  };

  const startDragGhost = useCallback((wordIdx: number, slotIdx: number) => {
    const chipEl = wordChipRefs.current.get(wordIdx);
    const slotEl = slotRefs.current.get(slotIdx);
    if (!chipEl || !slotEl) {
      setDemo(null);
      setDemoGhost(null);
      return;
    }

    const chipRect = chipEl.getBoundingClientRect();
    const slotRect = slotEl.getBoundingClientRect();
    const dropY = slotRect.top + slotRect.height - Math.min(chipRect.height + 8, slotRect.height * 0.45);
    const dropX = slotRect.left + slotRect.width / 2 - chipRect.width / 2;

    setDemoGhost({
      word: vocab[wordIdx]?.word ?? '',
      fromX: chipRect.left,
      fromY: chipRect.top,
      toX: dropX,
      toY: dropY,
      width: chipRect.width,
      height: chipRect.height,
      moving: false,
    });
    setDemo({ step: 'dragging', wordIdx, slotIdx });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setDemoGhost((prev) => (prev ? { ...prev, moving: true } : null));
      });
    });
  }, [vocab]);

  /**
   * Guided demo on the real UI — ghost chip animates from word bank to matching slot.
   * Purely visual — does NOT submit a placement or affect scoring.
   */
  const handleDemo = () => {
    clearDemoTimers();
    handleDismissCoach();

    const activeShuffled = shuffledWords.filter((wi) => activeDefIndices.includes(wi));
    const firstUnconfirmed = activeShuffled.find((wi) => !confirmed.has(wi));
    if (firstUnconfirmed == null) return;

    const matchingSlot = firstUnconfirmed;
    setDemo({ step: 'pick-word', wordIdx: firstUnconfirmed, slotIdx: matchingSlot });
    setDemoGhost(null);

    scheduleDemoStep(() => startDragGhost(firstUnconfirmed, matchingSlot), 700);
    scheduleDemoStep(() => {
      setDemoGhost(null);
      setDemo({ step: 'dropped', wordIdx: firstUnconfirmed, slotIdx: matchingSlot });
    }, 1700);
    scheduleDemoStep(() => {
      setDemo({ step: 'success', wordIdx: firstUnconfirmed, slotIdx: matchingSlot });
    }, 2400);
    scheduleDemoStep(() => {
      setDemo(null);
      setDemoGhost(null);
    }, 3600);
  };

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

        // A6: Show explicit praise briefly
        setCorrectFeedbackSlot(defIdx);
        setTimeout(() => setCorrectFeedbackSlot(null), 1200);

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
        // A6: Show "再試試看！" verbal feedback (amber, not silent bounce)
        setWrongFeedbackSlot(defIdx);
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
          setWrongFeedbackSlot(null);
        }, 650);
      }
    },
    [activeDefIndices.length, onAllDone],
  );

  const handleDragStart = (vocabIdx: number) => {
    if (demo !== null) return;
    setDraggingVocabIdx(vocabIdx);
    setTouchSelected(null);
  };
  const handleDragEnd = () => {
    setDraggingVocabIdx(null);
    setHoverTarget(null);
  };
  const handleDrop = (defIdx: number) => {
    if (demo !== null) return;
    if (draggingVocabIdx === null) return;
    setHoverTarget(null);
    attemptPlace(defIdx, draggingVocabIdx);
    setDraggingVocabIdx(null);
  };

  const handleTouchStart = (vocabIdx: number) => {
    if (demo !== null) return;
    if (confirmed.has(vocabIdx)) return;
    setTouchSelected((prev) => (prev === vocabIdx ? null : vocabIdx));
  };
  const handleSlotTap = (defIdx: number) => {
    if (demo !== null) return;
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

  // Sort: confirmed words to the back so remaining options stay near the top
  const sortedShuffledWords = useMemo(
    () => [...activeShuffledWords].sort((a, b) => {
      const aConfirmed = confirmed.has(a) ? 1 : 0;
      const bConfirmed = confirmed.has(b) ? 1 : 0;
      return aConfirmed - bConfirmed;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeShuffledWords, confirmed.size],
  );

  /* ---- Word bank chips (shared between mobile top strip and desktop left panel) ---- */
  const wordBankContent = (
    <>
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-on-surface-variant text-lg">dictionary</span>
        {/* A7: Renamed from 語詞庫 to 本課語詞 */}
        <span className="text-sm font-headline font-bold text-on-surface-variant uppercase tracking-wider">本課語詞</span>
      </div>
      <div className="flex flex-wrap gap-2 min-h-[56px]">
        {sortedShuffledWords.map((vocabIdx) => {
          const isPlaced = placedVocabIdxSet.has(vocabIdx);
          const isFlying = flyingAway.has(vocabIdx);
          // Fix #1101 (炮灰選項): Keep correctly-confirmed words visible as locked
          // "cannon fodder" chips so the last drag-drop question always has multiple
          // options in the bank — no more forced-correct final question.
          const isConfirmedWord = confirmed.has(vocabIdx);

          const isDragging = draggingVocabIdx === vocabIdx;
          const isTouchSelected = touchSelected === vocabIdx;
          const isDemoWord = demo?.wordIdx === vocabIdx;
          const isDemoDraggingWord = demo?.step === 'dragging' && demo.wordIdx === vocabIdx;

          // Confirmed words (fly-away animation already finished): show as locked/dimmed
          if (isConfirmedWord && !isFlying) {
            return (
              <div
                key={vocabIdx}
                className="rounded-2xl border-2 px-4 py-2.5 text-center font-bold text-lg select-none border-emerald-200 bg-emerald-50 text-emerald-400 cursor-not-allowed opacity-60 line-through"
                aria-label={`${vocab[vocabIdx]?.word} 已配對`}
                style={{ fontFamily: zhuyinFont }}
              >
                {zhuyinActive ? processZhuyin(vocab[vocabIdx]?.word ?? '') : vocab[vocabIdx]?.word}
              </div>
            );
          }

          // Placed but not yet confirmed (pending validation — bounce-back in progress).
          // Fly-away in progress (#1102) still needs to render its animation chip.
          if (isPlaced && !isFlying) return null;

          let cls =
            // #2144: 教授「拖拉字體小」— text-base→text-lg
            'rounded-2xl border-2 px-4 py-2.5 text-center font-bold text-lg select-none transition-all duration-200 ';
          if (isFlying) {
            cls += 'border-emerald-400 bg-emerald-100 text-emerald-700 animate-fly-away pointer-events-none';
          } else if (isDemoDraggingWord) {
            cls += 'border-dashed border-amber-300 bg-amber-50/40 text-amber-700/50 opacity-40 pointer-events-none';
          } else if (isDemoWord) {
            cls += 'border-amber-400 bg-amber-50 text-amber-800 ring-4 ring-amber-300/60 pointer-events-none';
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
              ref={(el) => {
                if (el) wordChipRefs.current.set(vocabIdx, el);
                else wordChipRefs.current.delete(vocabIdx);
              }}
              draggable={!isFlying && demo === null}
              onDragStart={() => !isFlying && handleDragStart(vocabIdx)}
              onDragEnd={handleDragEnd}
              onTouchStart={(e) => { e.stopPropagation(); if (!isFlying) handleTouchStart(vocabIdx); }}
              onClick={(e) => { e.stopPropagation(); if (!isFlying) handleTouchStart(vocabIdx); }}
              className={cls}
              style={{ fontFamily: zhuyinFont }}
            >
              {zhuyinActive ? processZhuyin(vocab[vocabIdx]?.word ?? '') : vocab[vocabIdx]?.word}
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

  // A8: Device-appropriate drop-zone hint text
  const dropHintText = IS_TOUCH_DEVICE ? '點選空格放入' : '拖拉語詞到這裡';

  const definitionSlots = sortedDefIndices.map((defIdx) => {
    const item = vocab[defIdx];
    const placedVocabIdx = placements.get(defIdx) ?? null;
    const isCorrect = confirmed.has(defIdx);
    const isWrong = wrongFlash.has(defIdx);
    const isOver = hoverTarget === defIdx && !isCorrect;
    const showWrongVerbal = wrongFeedbackSlot === defIdx;
    const showCorrectVerbal = correctFeedbackSlot === defIdx;
    const isDemoSlot = demo?.slotIdx === defIdx && !isCorrect;
    const isDemoDropped = (demo?.step === 'dropped' || demo?.step === 'success') && demo.slotIdx === defIdx;

    let cls =
      'rounded-3xl border-2 px-5 py-5 min-h-[80px] flex flex-col gap-2 transition-all duration-200 cursor-pointer ';
    if (isCorrect) {
      cls += 'bg-emerald-50 border-emerald-400 cursor-default';
    } else if (isDemoDropped) {
      cls += 'bg-emerald-50 border-emerald-400';
    } else if (isDemoSlot && demo?.step === 'dragging') {
      cls += 'bg-accent/5 border-accent ring-4 ring-accent/30 scale-[1.01] shadow-md';
    } else if (isDemoSlot && demo?.step === 'pick-word') {
      cls += 'bg-amber-50 border-amber-300';
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
        ref={(el) => {
          if (el) slotRefs.current.set(defIdx, el);
          else slotRefs.current.delete(defIdx);
        }}
        className={cls}
        onDragOver={(e) => {
          e.preventDefault();
          if (demo !== null || isCorrect) return;
          setHoverTarget(defIdx);
        }}
        onDragLeave={() => setHoverTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          handleDrop(defIdx);
        }}
        onClick={() => handleSlotTap(defIdx)}
      >
        {/* A7: text-base → text-lg md:text-xl leading-relaxed
            #2144: 教授「定義字換色」— 答對後定義文字轉綠，強化配對成功訊號 */}
        <p className={`text-lg md:text-xl leading-relaxed ${isCorrect ? 'text-emerald-700 font-semibold' : 'text-on-surface'}`}>{item?.definition}</p>
        <div className="flex items-center justify-center h-8">
          {isCorrect ? (
            <span className="font-bold text-base text-emerald-700 flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold">
                ✓
              </span>
              {placedVocabIdx !== null ? vocab[placedVocabIdx]?.word : ''}
              {/* A6: explicit correct praise */}
              {showCorrectVerbal && (
                <span className="ml-2 text-sm font-bold text-emerald-600 animate-pulse">
                  答對了！
                </span>
              )}
            </span>
          ) : showWrongVerbal ? (
            /* A6: wrong verbal feedback — amber text, not silent bounce */
            <span className="font-bold text-sm text-amber-600 animate-pulse">
              再試試看！
            </span>
          ) : isDemoDropped ? (
            <span className="font-bold text-base text-emerald-700 flex items-center gap-1">
              {demo?.step === 'success' && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white text-xs font-bold">
                  ✓
                </span>
              )}
              {vocab[demo?.wordIdx ?? defIdx]?.word}
            </span>
          ) : placedVocabIdx !== null ? (
            <span className="font-bold text-base text-amber-800">
              {vocab[placedVocabIdx]?.word}
            </span>
          ) : (
            <span className="text-xs text-on-surface-variant/40 select-none">
              {dropHintText}
            </span>
          )}
        </div>
      </div>
    );
  });

  // A8: Device-appropriate top-level instruction
  const instructionText = IS_TOUCH_DEVICE
    ? '點選語詞，再點下方空格放入'
    : '把右邊的語詞拖到左邊正確的解釋上';

  return (
    <div className="px-4 md:px-6 max-w-5xl mx-auto">
      {demo?.step === 'pick-word' && (
        <DemoBubble>
          {IS_TOUCH_DEVICE ? '① 先點選上方語詞' : '① 按住右邊的語詞'}
        </DemoBubble>
      )}
      {demo?.step === 'dragging' && (
        <DemoBubble>
          {IS_TOUCH_DEVICE ? '② 再點到下方對應的解釋框' : '② 拖到左邊對應的解釋框'}
        </DemoBubble>
      )}
      {(demo?.step === 'dropped' || demo?.step === 'success') && (
        <DemoBubble>
          {demo.step === 'success' ? '✓ 配對成功！就是這樣玩' : '③ 放開就完成配對'}
        </DemoBubble>
      )}

      {demoGhost && (
        <>
          <div
            className="fixed z-50 pointer-events-none rounded-2xl border-2 border-accent bg-accent/10 text-accent font-bold text-lg shadow-xl flex items-center justify-center select-none"
            style={{
              left: demoGhost.moving ? demoGhost.toX : demoGhost.fromX,
              top: demoGhost.moving ? demoGhost.toY : demoGhost.fromY,
              width: demoGhost.width,
              height: demoGhost.height,
              transition: demoGhost.moving ? 'left 0.9s ease-in-out, top 0.9s ease-in-out' : 'none',
              fontFamily: zhuyinFont,
            }}
            aria-hidden
          >
            {zhuyinActive
              ? processZhuyin(demoGhost.word)
              : demoGhost.word}
          </div>
          <span
            className="fixed z-50 pointer-events-none text-xl"
            style={{
              left: (demoGhost.moving ? demoGhost.toX : demoGhost.fromX) + demoGhost.width * 0.65,
              top: (demoGhost.moving ? demoGhost.toY : demoGhost.fromY) + demoGhost.height * 0.35,
              transition: demoGhost.moving ? 'left 0.9s ease-in-out, top 0.9s ease-in-out' : 'none',
            }}
            aria-hidden
          >
            {IS_TOUCH_DEVICE ? '👆' : '🖱️'}
          </span>
        </>
      )}

      {/* Onboarding coach — shown first time or when student clicks help */}
      {showCoach && <OnboardingCoach onDismiss={handleDismissCoach} onDemo={handleDemo} />}

      {/* A8: Device-aware instruction banner — only shown after coach is dismissed */}
      {!showCoach && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-center text-on-surface-variant">
            <span className="material-symbols-outlined align-middle text-base mr-1">
              {IS_TOUCH_DEVICE ? 'touch_app' : 'drag_indicator'}
            </span>
            {instructionText}
          </p>
          <button
            type="button"
            onClick={() => setShowCoach(true)}
            className="text-xs text-on-surface-variant/60 hover:text-on-surface-variant transition-colors flex items-center gap-1 shrink-0"
          >
            <span className="material-symbols-outlined text-sm">help_outline</span>
            怎麼玩？
          </button>
        </div>
      )}

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
          {/* A7: Renamed from 定義欄位 to 語詞解釋 */}
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 text-center md:text-left">
            語詞解釋
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

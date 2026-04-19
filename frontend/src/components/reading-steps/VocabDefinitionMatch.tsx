/**
 * VocabDefinitionMatch — Step Component for 語詞定義配對
 *
 * 支援兩種互動模式 (#697, restored #728):
 *   - 選擇題 (Multiple Choice) — DEFAULT
 *   - 拖拉配對 (Drag & Drop)
 *
 * Flow:
 *   matching → summary (score + per-question) → retry wrong / retry all / finish
 *
 * No hints during answering (#710): wrong answer silently recorded, immediately advance.
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
import { Lock } from 'lucide-react';
import { Story, VocabItem } from '../../types';
import { scopedStepStorageKey } from '../../services/learningStorageScope';
import { useZhuyin } from '../../context/ZhuyinContext';

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
  initialProgress?: Record<string, unknown>;
  onProgressChange?: (stepData: Record<string, unknown>, immediate?: boolean) => void;
}

type InteractionMode = 'multiple-choice' | 'drag-drop';
type Phase = 'matching' | 'summary';

/**
 * Records the answer for one vocabulary item.
 * answeredWordIdx === null  → not yet answered
 * answeredWordIdx === defIndex → correct
 * answeredWordIdx !== defIndex → wrong
 */
interface AnswerRecord {
  defIndex: number;
  answeredWordIdx: number | null;
  correct: boolean | null;
  wrongAttempts?: number;
}

interface PersistedProgress {
  mode?: InteractionMode;
  phase?: Phase;
  activeDefIndices?: number[];
  mcAnswers?: AnswerRecord[];
  dragDropAnswers?: AnswerRecord[];
}

function getDragDropAttemptFeedback(wrongAttempts: number): string | null {
  if (wrongAttempts === 1) return null;
  if (wrongAttempts === 2) return '下次小心喔～';
  if (wrongAttempts >= 3) return `要不要再複習一遍`;
  return null;
}

function getDragDropAttemptTone(wrongAttempts: number): {
  cardClass: string;
  badgeClass: string;
} {
  if (wrongAttempts >= 3) {
    return {
      cardClass: 'bg-red-50 border-red-200',
      badgeClass: 'bg-red-500',
    };
  }
  if (wrongAttempts === 2) {
    return {
      cardClass: 'bg-amber-50 border-amber-200',
      badgeClass: 'bg-amber-500',
    };
  }
  return {
    cardClass: 'bg-emerald-50 border-emerald-200',
    badgeClass: 'bg-emerald-500',
  };
}

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

function NoDataFallback({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-surface">
      <div className="text-center space-y-4 p-8">
        <span className="material-symbols-outlined text-5xl text-on-surface-variant/30">dictionary</span>
        <p className="text-on-surface-variant">本課尚無語詞定義資料</p>
        <button onClick={onFinish} className="btn-immersive">
          繼續下一步 <span className="material-symbols-outlined text-lg ml-1">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SummaryScreen                                                       */
/* ------------------------------------------------------------------ */

interface SummaryScreenProps {
  vocab: VocabItem[];
  mcAnswers: AnswerRecord[];
  dragDropAnswers: AnswerRecord[];
  onRetryModeWrong: (mode: InteractionMode) => void;
  onRetryAll: () => void;
  onFinish: () => void;
}

function SummaryScreen({
  vocab,
  mcAnswers,
  dragDropAnswers,
  onRetryModeWrong,
  onRetryAll,
  onFinish,
}: SummaryScreenProps) {
  const mcCorrect = mcAnswers.filter((a) => a.correct).length;
  const mcTotal = mcAnswers.length;
  const dragDropCorrect = dragDropAnswers.filter((a) => a.correct).length;
  const dragDropTotal = dragDropAnswers.length;
  const correctCount = mcCorrect + dragDropCorrect;
  const total = mcTotal + dragDropTotal;
  const allCorrect = correctCount === total;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const mcWrongAnswers = mcAnswers.filter((a) => !a.correct);
  const dragDropWrongAnswers = dragDropAnswers.filter((a) => !a.correct);

  const renderResultSection = (title: string, answers: AnswerRecord[], mode: InteractionMode) => (
    <div className="flex flex-col gap-3 mb-6">
      <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
        {title}
      </h4>
      {answers.map((ans, idx) => {
        const item = vocab[ans.defIndex];
        const isCorrect = ans.correct;
        const studentWord =
          ans.answeredWordIdx !== null ? vocab[ans.answeredWordIdx]?.word : '—';
        const wrongAttempts = ans.wrongAttempts ?? 0;
        const feedback = mode === 'drag-drop'
          ? getDragDropAttemptFeedback(wrongAttempts)
          : null;
        const dragDropTone = getDragDropAttemptTone(wrongAttempts);
        const cardClass = mode === 'drag-drop'
          ? dragDropTone.cardClass
          : (isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200');
        const badgeClass = mode === 'drag-drop'
          ? dragDropTone.badgeClass
          : (isCorrect ? 'bg-emerald-500' : 'bg-red-500');

        return (
          <div
            key={`${title}-${idx}`}
            className={`rounded-xl border-2 px-4 py-3 flex items-start gap-3 ${cardClass}`}
          >
            <span
              className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${badgeClass}`}
            >
              {isCorrect ? '✓' : '✗'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500 leading-snug mb-1">
                {item?.definition}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-gray-500">正確答案：</span>
                <span className="font-bold text-gray-800">{item?.word}</span>
                {!isCorrect && (
                  <>
                    <span className="text-gray-400">|</span>
                    <span className="text-gray-500">你的答案：</span>
                    <span className="font-bold text-red-600">{studentWord}</span>
                  </>
                )}
              </div>
              {feedback && (
                <p className="mt-1 text-xs font-semibold text-amber-700">{feedback}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-48 animate-fade-in">
      {/* Score card */}
      <div className={`rounded-3xl p-8 mb-8 text-center ${allCorrect ? 'bg-emerald-50' : 'bg-surface-container-lowest shadow-editorial'}`}>
        <div className={`w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center ${allCorrect ? 'bg-emerald-100' : 'bg-tertiary-container/20'}`}>
          <span className={`material-symbols-outlined text-4xl ${allCorrect ? 'text-emerald-600' : 'text-tertiary'}`}>
            {allCorrect ? 'emoji_events' : 'school'}
          </span>
        </div>
        <p className="text-2xl font-headline font-black text-on-surface mb-1">
          {allCorrect ? '全部答對！' : `答對 ${correctCount} / ${total} 題`}
        </p>
        <p className="text-sm text-on-surface-variant">正確率 {pct}%</p>
      </div>

      {renderResultSection('第一關：選擇題', mcAnswers, 'multiple-choice')}
      {renderResultSection('第二關：拖拉配對', dragDropAnswers, 'drag-drop')}

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-0 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto flex flex-col gap-2">
          {(mcWrongAnswers.length > 0 || dragDropWrongAnswers.length > 0) && (
            <button
              onClick={() => mcWrongAnswers.length > 0 ? onRetryModeWrong('multiple-choice') : onRetryModeWrong('drag-drop')}
              className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all">
              重做錯題
            </button>
          )}
          <button onClick={onRetryAll}
            className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface-variant bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] transition-all">
            全部重做
          </button>
          <button onClick={onFinish}
            className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
            繼續下一步
            <span className="material-symbols-outlined text-xl">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stage Status                                                        */
/* ------------------------------------------------------------------ */

function StageStatus({
  current,
  mcDone,
  dragDropDone,
}: {
  current: InteractionMode;
  mcDone: boolean;
  dragDropDone: boolean;
}) {
  const step1Active = current === 'multiple-choice';
  const step2Active = current === 'drag-drop';
  const step2Locked = !mcDone;

  return (
    <div className="flex items-center justify-center gap-0 mb-6 max-w-sm mx-auto select-none">
      {/* Step 1 */}
      <div className="flex flex-col items-center gap-1">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
            mcDone
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : step1Active
                ? 'bg-accent border-accent text-white'
                : 'bg-white border-gray-300 text-gray-400'
          }`}
        >
          {mcDone ? '✓' : '1'}
        </div>
        <span
          className={`text-xs font-semibold whitespace-nowrap ${
            step1Active ? 'text-accent' : mcDone ? 'text-emerald-600' : 'text-gray-400'
          }`}
        >
          選擇題
        </span>
      </div>

      {/* Connector line */}
      <div
        className={`h-0.5 w-12 mb-4 transition-colors ${
          mcDone ? 'bg-emerald-400' : 'bg-gray-200'
        }`}
      />

      {/* Step 2 */}
      <div className="flex flex-col items-center gap-1">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
            dragDropDone
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : step2Active
                ? 'bg-accent border-accent text-white'
                : 'bg-gray-100 border-gray-200 text-gray-300'
          }`}
        >
          {dragDropDone ? '✓' : step2Locked ? <Lock size={14} /> : '2'}
        </div>
        <span
          className={`text-xs font-semibold whitespace-nowrap ${
            step2Active ? 'text-accent' : dragDropDone ? 'text-emerald-600' : 'text-gray-300'
          }`}
        >
          拖拉配對
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mode 1: Multiple Choice (選擇題) — DEFAULT                          */
/* ------------------------------------------------------------------ */

interface MultipleChoiceProps {
  vocab: VocabItem[];
  activeDefIndices: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
}

function MultipleChoiceMode({ vocab, activeDefIndices, onAllDone }: MultipleChoiceProps) {
  const [queueIdx, setQueueIdx] = useState(0);
  const answersRef = useRef<AnswerRecord[]>(
    activeDefIndices.map((defIdx) => ({ defIndex: defIdx, answeredWordIdx: null, correct: null })),
  );
  const [pendingAdvance, setPendingAdvance] = useState(false);

  useEffect(() => {
    setQueueIdx(0);
    setPendingAdvance(false);
    answersRef.current = activeDefIndices.map((defIdx) => ({
      defIndex: defIdx,
      answeredWordIdx: null,
      correct: null,
    }));
  }, [activeDefIndices]);

  const currentDefIdx = activeDefIndices[queueIdx];

  // Shuffle 4 options for current question (1 correct + 3 distractors from all vocab)
  const options = useMemo(() => {
    const allIndices = vocab.map((_, i) => i);
    const distractors = shuffle(allIndices.filter((i) => i !== currentDefIdx)).slice(0, 3);
    return shuffle([currentDefIdx, ...distractors]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueIdx, currentDefIdx, vocab]);

  const handleChoice = (vocabIdx: number) => {
    if (pendingAdvance) return;

    const isCorrect = vocabIdx === currentDefIdx;

    // Record answer silently — no shake, no reveal (#710)
    answersRef.current = answersRef.current.map((a) =>
      a.defIndex === currentDefIdx
        ? { ...a, answeredWordIdx: vocabIdx, correct: isCorrect }
        : a,
    );

    setPendingAdvance(true);
    setTimeout(() => {
      setPendingAdvance(false);
      const nextIdx = queueIdx + 1;
      if (nextIdx >= activeDefIndices.length) {
        onAllDone(answersRef.current);
      } else {
        setQueueIdx(nextIdx);
      }
    }, 400);
  };

  const item = vocab[currentDefIdx];

  return (
    <div className="max-w-2xl mx-auto px-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2.5 bg-surface-container-high rounded-full overflow-hidden">
          <div className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
            style={{ width: `${activeDefIndices.length > 0 ? (queueIdx / activeDefIndices.length) * 100 : 0}%` }} />
        </div>
        <span className="text-sm font-headline font-bold text-on-surface-variant shrink-0">
          {queueIdx + 1} / {activeDefIndices.length}
        </span>
      </div>

      {/* Definition card */}
      <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 mb-6">
        <p className="text-xl md:text-2xl text-on-surface leading-[2.5rem] md:leading-[3rem]">{item?.definition}</p>
      </div>

      {/* Options — 2-column grid */}
      <div className="grid grid-cols-2 gap-3">
        {options.map((vocabIdx) => (
          <button
            key={vocabIdx}
            className="rounded-2xl border-2 p-4 text-center font-bold text-xl transition-all duration-200 select-none active:scale-[0.97] min-h-[56px] border-surface-container-high bg-surface-container-lowest text-on-surface hover:border-accent hover:bg-accent/5 disabled:opacity-50"
            onClick={() => handleChoice(vocabIdx)}
            disabled={pendingAdvance}
          >
            {vocab[vocabIdx]?.word}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mode 2: Drag & Drop (拖拉配對)                                      */
/* ------------------------------------------------------------------ */

interface DragDropProps {
  vocab: VocabItem[];
  activeDefIndices: number[];
  shuffledWords: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
}

function DragDropMode({ vocab, activeDefIndices, shuffledWords, onAllDone }: DragDropProps) {
  const [draggingVocabIdx, setDraggingVocabIdx] = useState<number | null>(null);
  const [placements, setPlacements] = useState<Map<number, number>>(new Map());
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [wrongFlash, setWrongFlash] = useState<Set<number>>(new Set());
  const [hoverTarget, setHoverTarget] = useState<number | null>(null);
  const [touchSelected, setTouchSelected] = useState<number | null>(null);

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
        // Correct
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

        setConfirmed((prev) => {
          const next = new Set(prev);
          next.add(defIdx);
          if (next.size === activeDefIndices.length) {
            setTimeout(() => onAllDone(answersRef.current), 600);
          }
          return next;
        });
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
          if (isPlaced) return null;

          const isDragging = draggingVocabIdx === vocabIdx;
          const isTouchSelected = touchSelected === vocabIdx;

          let cls =
            'rounded-2xl border-2 px-4 py-2.5 text-center font-bold text-base select-none transition-all duration-200 ';
          if (isDragging) {
            cls += 'border-accent bg-accent/10 text-accent shadow-xl scale-105 opacity-80 cursor-grabbing';
          } else if (isTouchSelected) {
            cls += 'border-accent bg-accent/10 text-accent shadow-md scale-105 cursor-pointer';
          } else {
            cls += 'border-surface-container-high bg-surface-container-lowest text-on-surface hover:border-accent hover:bg-accent/5 active:scale-95 cursor-grab';
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
  const definitionSlots = activeDefIndices.map((defIdx) => {
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

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */

const VocabDefinitionMatch: React.FC<VocabDefinitionMatchProps> = ({
  story,
  onFinish,
  initialProgress,
  onProgressChange,
}) => {
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;
  const zhuyinFont = zhuyinActive
    ? "'BpmfZihiSans', 'Noto Sans TC', sans-serif"
    : undefined;

  const progressStorageKey = scopedStepStorageKey('vocabDef_progress_', story.id);
  const vocab: VocabItem[] = story.vocabulary ?? [];
  const hasData = vocab.length > 0;
  const allIndices = useMemo(() => vocab.map((_, i) => i), [vocab]);

  const persistedProgress = useMemo<PersistedProgress>(() => {
    try {
      const raw = localStorage.getItem(progressStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as PersistedProgress;
    } catch {
      return {};
    }
  }, [progressStorageKey]);

  const mergedInitialProgress = useMemo<PersistedProgress>(() => {
    const source = initialProgress && typeof initialProgress === 'object'
      ? (initialProgress as PersistedProgress)
      : {};

    return {
      mode: source.mode ?? persistedProgress.mode,
      phase: source.phase ?? persistedProgress.phase,
      activeDefIndices: source.activeDefIndices ?? persistedProgress.activeDefIndices,
      mcAnswers: source.mcAnswers ?? persistedProgress.mcAnswers,
      dragDropAnswers: source.dragDropAnswers ?? persistedProgress.dragDropAnswers,
    };
  }, [initialProgress, persistedProgress]);

  const [mode, setMode] = useState<InteractionMode>(() => {
    const persistedMode = mergedInitialProgress.mode;
    if (persistedMode === 'multiple-choice' || persistedMode === 'drag-drop') {
      return persistedMode;
    }
    return 'multiple-choice';
  });

  const [phase, setPhase] = useState<Phase>(() => {
    const p = mergedInitialProgress.phase;
    return p === 'matching' || p === 'summary' ? p : 'matching';
  });

  // Which defIndices are active in the current stage
  const [activeDefIndices, setActiveDefIndices] = useState<number[]>(() =>
    Array.isArray(mergedInitialProgress.activeDefIndices)
      ? mergedInitialProgress.activeDefIndices
      : vocab.map((_, i) => i),
  );

  // Stable shuffled word order for drag-drop (regenerated on retry)
  const shuffledWords = useRef<number[]>(shuffle(vocab.map((_, i) => i)));

  const [mcAnswers, setMcAnswers] = useState<AnswerRecord[]>(() =>
    Array.isArray(mergedInitialProgress.mcAnswers)
      ? mergedInitialProgress.mcAnswers
      : [],
  );

  const [dragDropAnswers, setDragDropAnswers] = useState<AnswerRecord[]>(() =>
    Array.isArray(mergedInitialProgress.dragDropAnswers)
      ? mergedInitialProgress.dragDropAnswers
      : [],
  );

  const isStepCompleted =
    phase === 'summary' && mcAnswers.length > 0 && dragDropAnswers.length > 0;

  const buildProgressPayload = useCallback(() => ({
    mode,
    phase,
    activeDefIndices,
    mcAnswers,
    dragDropAnswers,
    completed: isStepCompleted,
  }), [mode, phase, activeDefIndices, mcAnswers, dragDropAnswers, isStepCompleted]);

  // Persist to localStorage so page close / logout / cross-step navigation can restore.
  useEffect(() => {
    try {
      const payload: PersistedProgress = buildProgressPayload();
      localStorage.setItem(progressStorageKey, JSON.stringify(payload));
    } catch {}
  }, [progressStorageKey, buildProgressPayload]);

  // Persist process data so reopen can restore previous learning status.
  useEffect(() => {
    if (!onProgressChange) return;
    onProgressChange(buildProgressPayload(), false);
  }, [onProgressChange, buildProgressPayload]);

  const completionFlushedRef = useRef(false);
  useEffect(() => {
    if (!onProgressChange) return;
    if (!isStepCompleted) {
      completionFlushedRef.current = false;
      return;
    }
    if (completionFlushedRef.current) return;

    onProgressChange(buildProgressPayload(), true);
    completionFlushedRef.current = true;
  }, [onProgressChange, isStepCompleted, buildProgressPayload]);

  const startStage = useCallback((nextMode: InteractionMode, indices: number[]) => {
    setMode(nextMode);
    setPhase('matching');
    setActiveDefIndices(indices);
    shuffledWords.current = shuffle(indices);
  }, []);

  const handleAllDone = useCallback((answers: AnswerRecord[]) => {
    if (mode === 'multiple-choice') {
      setMcAnswers(answers);
      startStage('drag-drop', allIndices);
      return;
    }
    setDragDropAnswers(answers);
    setPhase('summary');
  }, [mode, startStage, allIndices]);

  const handleRetryModeWrong = useCallback((targetMode: InteractionMode) => {
    const sourceAnswers = targetMode === 'multiple-choice' ? mcAnswers : dragDropAnswers;
    const wrongIndices = sourceAnswers.filter((a) => !a.correct).map((a) => a.defIndex);
    if (wrongIndices.length === 0) return;
    startStage(targetMode, wrongIndices);
  }, [mcAnswers, dragDropAnswers, startStage]);

  const handleRetryAll = useCallback(() => {
    setMcAnswers([]);
    setDragDropAnswers([]);
    startStage('multiple-choice', allIndices);
  }, [startStage, allIndices]);

  const handleFinish = useCallback(() => {
    const correctCount =
      mcAnswers.filter((a) => a.correct).length +
      dragDropAnswers.filter((a) => a.correct).length;
    onProgressChange?.(
      buildProgressPayload(),
      true,
    );
    onFinish({ matchedCount: correctCount, totalCount: vocab.length * 2 });
  }, [
    onProgressChange,
    buildProgressPayload,
    onFinish,
    vocab.length,
  ]);

  const modeSubtitles: Record<InteractionMode, string> = {
    'multiple-choice': '看定義，選出對應的語詞',
    'drag-drop': '拖拉語詞卡片到對應的定義欄位',
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface overflow-hidden" style={{ fontFamily: zhuyinFont }}>
      <div className="flex-1 overflow-y-auto min-h-0 py-6">
        {!hasData ? (
          <NoDataFallback onFinish={handleFinish} />
        ) : phase === 'summary' ? (
          <SummaryScreen
            vocab={vocab}
            mcAnswers={mcAnswers}
            dragDropAnswers={dragDropAnswers}
            onRetryModeWrong={handleRetryModeWrong}
            onRetryAll={handleRetryAll}
            onFinish={handleFinish}
          />
        ) : (
          <>
            <StageStatus
              current={mode}
              mcDone={mcAnswers.length > 0}
              dragDropDone={dragDropAnswers.length > 0}
            />

            {mode === 'multiple-choice' && (
              <MultipleChoiceMode
                vocab={vocab}
                activeDefIndices={activeDefIndices}
                onAllDone={handleAllDone}
              />
            )}
            {mode === 'drag-drop' && (
              <DragDropMode
                vocab={vocab}
                activeDefIndices={activeDefIndices}
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

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

/* ------------------------------------------------------------------ */
/*  SummaryScreen                                                       */
/* ------------------------------------------------------------------ */

interface SummaryScreenProps {
  vocab: VocabItem[];
  answers: AnswerRecord[];
  onRetryWrong: () => void;
  onRetryAll: () => void;
  onFinish: () => void;
}

function SummaryScreen({
  vocab,
  answers,
  onRetryWrong,
  onRetryAll,
  onFinish,
}: SummaryScreenProps) {
  const correctCount = answers.filter((a) => a.correct).length;
  const total = answers.length;
  const allCorrect = correctCount === total;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const wrongAnswers = answers.filter((a) => !a.correct);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 animate-fade-in">
      {/* Score card */}
      <div
        className={`rounded-2xl border-2 px-8 py-6 mb-8 text-center shadow-sm ${
          allCorrect
            ? 'bg-emerald-50 border-emerald-300'
            : 'bg-amber-50 border-amber-300'
        }`}
      >
        <div className="text-5xl select-none mb-3">
          {allCorrect ? '🎉' : pct >= 60 ? '👍' : '💪'}
        </div>
        <h3
          className={`text-2xl font-black mb-1 ${
            allCorrect ? 'text-emerald-800' : 'text-amber-800'
          }`}
        >
          {allCorrect ? '全部答對！' : `答對 ${correctCount} / ${total} 題`}
        </h3>
        <p
          className={`text-lg font-semibold ${
            allCorrect ? 'text-emerald-600' : 'text-amber-600'
          }`}
        >
          正確率 {pct}%
        </p>
      </div>

      {/* Per-question results */}
      <div className="flex flex-col gap-3 mb-8">
        <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
          每題結果
        </h4>
        {answers.map((ans, idx) => {
          const item = vocab[ans.defIndex];
          const isCorrect = ans.correct;
          const studentWord =
            ans.answeredWordIdx !== null ? vocab[ans.answeredWordIdx]?.word : '—';

          return (
            <div
              key={idx}
              className={`rounded-xl border-2 px-4 py-3 flex items-start gap-3 ${
                isCorrect
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <span
                className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${
                  isCorrect ? 'bg-emerald-500' : 'bg-red-500'
                }`}
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
              </div>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        {!allCorrect && (
          <button
            onClick={onRetryWrong}
            className="rounded-xl border-2 border-[#5B4FC4] text-[#5B4FC4] px-6 py-3 font-bold hover:bg-[#5B4FC4] hover:text-white transition-all active:scale-95"
          >
            只重做錯題（{wrongAnswers.length} 題）
          </button>
        )}
        <button
          onClick={onRetryAll}
          className="rounded-xl border-2 border-gray-300 text-gray-700 px-6 py-3 font-bold hover:bg-gray-100 transition-all active:scale-95"
        >
          全部重做
        </button>
        <button
          onClick={onFinish}
          className="rounded-xl bg-[#5B4FC4] px-8 py-3 text-white font-bold hover:bg-[#4a3fb0] transition-all active:scale-95 shadow-md"
        >
          繼續下一步 →
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mode Switcher                                                       */
/* ------------------------------------------------------------------ */

const MODE_LABELS: { id: InteractionMode; label: string; icon: string }[] = [
  { id: 'multiple-choice', label: '選擇題', icon: '☑' },
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
  activeDefIndices: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
}

function MultipleChoiceMode({ vocab, activeDefIndices, onAllDone }: MultipleChoiceProps) {
  const [queueIdx, setQueueIdx] = useState(0);
  const answersRef = useRef<AnswerRecord[]>(
    activeDefIndices.map((defIdx) => ({ defIndex: defIdx, answeredWordIdx: null, correct: null })),
  );
  const [pendingAdvance, setPendingAdvance] = useState(false);

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
    <div className="max-w-xl mx-auto px-4">
      {/* Progress */}
      <div className="mb-5 bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-500">題目進度</span>
        <span className="text-base font-black text-amber-700">
          {queueIdx + 1}{' '}
          <span className="text-gray-400 font-normal text-sm">/ {activeDefIndices.length}</span>
        </span>
      </div>

      {/* Definition card */}
      <div className="bg-white border-2 border-[#5B4FC4] rounded-2xl p-6 mb-6 shadow-sm">
        <p className="text-xs font-semibold text-[#5B4FC4] uppercase tracking-wider mb-2">
          定義
        </p>
        <p className="text-lg text-gray-800 leading-relaxed">{item?.definition}</p>
      </div>

      {/* Options */}
      <p className="text-center text-sm text-gray-500 mb-3 select-none">
        請選出對應的語詞
      </p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((vocabIdx) => (
          <button
            key={vocabIdx}
            className="rounded-xl border-2 px-4 py-4 text-center font-bold text-xl transition-all duration-200 select-none bg-white border-gray-200 text-gray-800 hover:border-[#5B4FC4] hover:bg-purple-50 hover:shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
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
        answersRef.current = answersRef.current.map((a) =>
          a.defIndex === defIdx ? { ...a, answeredWordIdx: vocabIdx, correct: true } : a,
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
        answersRef.current = answersRef.current.map((a) =>
          a.defIndex === defIdx ? { ...a, answeredWordIdx: vocabIdx, correct: false } : a,
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
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 text-center">
        語詞庫
      </p>
      <div className="flex flex-wrap gap-2 justify-center min-h-[56px] bg-gray-50 rounded-xl p-3 border border-gray-200">
        {activeShuffledWords.map((vocabIdx) => {
          const isPlaced = placedVocabIdxSet.has(vocabIdx);
          if (isPlaced) return null;

          const isDragging = draggingVocabIdx === vocabIdx;
          const isTouchSelected = touchSelected === vocabIdx;

          let cls =
            'rounded-xl border-2 px-5 py-3 text-center font-bold text-xl select-none transition-all duration-200 ';
          if (isDragging) {
            cls += 'border-[#5B4FC4] bg-purple-100 text-purple-900 shadow-xl scale-105 opacity-80 cursor-grabbing';
          } else if (isTouchSelected) {
            cls += 'border-[#5B4FC4] bg-purple-100 text-purple-900 shadow-md scale-105 cursor-pointer';
          } else {
            cls += 'border-gray-200 bg-white text-gray-800 hover:border-[#5B4FC4] hover:bg-purple-50 hover:shadow-sm active:scale-95 cursor-grab';
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
        <p className="text-center text-xs text-[#5B4FC4] mt-2 font-medium">
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
        <p className="text-sm text-gray-700 leading-relaxed">{item?.definition}</p>
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
            <span className="text-xs text-gray-400 select-none">
              拖拉語詞到這裡
            </span>
          )}
        </div>
      </div>
    );
  });

  return (
    <div className="px-4 md:px-6 max-w-5xl mx-auto">
      {/* Progress */}
      <div className="mb-4 bg-white rounded-2xl shadow-sm border border-amber-100 px-5 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-500">配對進度</span>
        <span className="text-base font-black text-amber-700">
          {confirmed.size}{' '}
          <span className="text-gray-400 font-normal text-sm">/ {activeDefIndices.length}</span>
        </span>
      </div>

      <p className="text-center text-sm text-amber-800 bg-amber-100 rounded-xl py-2 px-4 mb-4 select-none font-medium">
        拖拉語詞卡片到對應的定義欄位，手機可先點選語詞再點選欄位
      </p>

      {/* Mobile: word bank on top (sticky so it stays visible while scrolling definitions) */}
      <div className="md:hidden sticky top-0 z-10 bg-amber-50 pb-3 pt-1">
        {wordBankContent}
      </div>

      {/* Desktop: two-column layout — definitions left (scrollable), word bank right (sticky) */}
      <div className="md:flex md:gap-6 md:items-start">
        {/* Left column — definition slots */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 text-center md:text-left">
            定義欄位
          </p>
          <div className="flex flex-col gap-3">
            {definitionSlots}
          </div>
        </div>

        {/* Right column — word bank panel, sticky (desktop only) */}
        <div className="hidden md:block w-52 flex-shrink-0 sticky top-4 self-start">
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
}) => {
  const storageModeKey = `vocabDef_mode_${story.id}`;
  const vocab: VocabItem[] = story.vocabulary ?? [];
  const hasData = vocab.length > 0;

  const [mode, setMode] = useState<InteractionMode>(() => {
    try {
      const saved = localStorage.getItem(storageModeKey) as InteractionMode | null;
      if (saved && ['multiple-choice', 'drag-drop'].includes(saved)) {
        return saved;
      }
    } catch {}
    return 'multiple-choice';
  });

  const [phase, setPhase] = useState<Phase>('matching');

  // Which defIndices are active in the current round
  const [activeDefIndices, setActiveDefIndices] = useState<number[]>(() =>
    vocab.map((_, i) => i),
  );

  // Stable shuffled word order for drag-drop (regenerated on retry)
  const shuffledWords = useRef<number[]>(shuffle(vocab.map((_, i) => i)));

  // Summary answers from the last completed round
  const [summaryAnswers, setSummaryAnswers] = useState<AnswerRecord[]>([]);

  // Increment to force-remount the active mode on mode change or retry
  const [modeKey, setModeKey] = useState(0);

  const handleModeChange = (m: InteractionMode) => {
    setMode(m);
    setPhase('matching');
    setActiveDefIndices(vocab.map((_, i) => i));
    shuffledWords.current = shuffle(vocab.map((_, i) => i));
    setModeKey((k) => k + 1);
    try {
      localStorage.setItem(storageModeKey, m);
    } catch {}
  };

  const handleAllDone = useCallback((answers: AnswerRecord[]) => {
    setSummaryAnswers(answers);
    setPhase('summary');
  }, []);

  const handleRetryWrong = useCallback(() => {
    const wrongIndices = summaryAnswers
      .filter((a) => !a.correct)
      .map((a) => a.defIndex);
    setActiveDefIndices(wrongIndices);
    shuffledWords.current = shuffle(wrongIndices);
    setPhase('matching');
    setModeKey((k) => k + 1);
  }, [summaryAnswers]);

  const handleRetryAll = useCallback(() => {
    const allIndices = vocab.map((_, i) => i);
    setActiveDefIndices(allIndices);
    shuffledWords.current = shuffle(allIndices);
    setPhase('matching');
    setModeKey((k) => k + 1);
  }, [vocab]);

  const handleFinish = useCallback(() => {
    // Keep completion record — only clear on explicit redo
    const correctCount = summaryAnswers.filter((a) => a.correct).length;
    onFinish({ matchedCount: correctCount, totalCount: vocab.length });
  }, [onFinish, summaryAnswers, vocab.length]);

  const modeSubtitles: Record<InteractionMode, string> = {
    'multiple-choice': '看定義，選出對應的語詞',
    'drag-drop': '拖拉語詞卡片到對應的定義欄位',
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-amber-50">
      <StepHeader
        title="語詞定義配對"
        subtitle={phase === 'summary' ? '作答結果' : modeSubtitles[mode]}
      />

      <div className="flex-1 overflow-y-auto min-h-0 py-6">
        {!hasData ? (
          <NoDataFallback onFinish={handleFinish} />
        ) : phase === 'summary' ? (
          <SummaryScreen
            vocab={vocab}
            answers={summaryAnswers}
            onRetryWrong={handleRetryWrong}
            onRetryAll={handleRetryAll}
            onFinish={handleFinish}
          />
        ) : (
          <>
            <ModeSwitcher current={mode} onChange={handleModeChange} />

            {mode === 'multiple-choice' && (
              <MultipleChoiceMode
                key={`mc-${modeKey}`}
                vocab={vocab}
                activeDefIndices={activeDefIndices}
                onAllDone={handleAllDone}
              />
            )}
            {mode === 'drag-drop' && (
              <DragDropMode
                key={`dd-${modeKey}`}
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

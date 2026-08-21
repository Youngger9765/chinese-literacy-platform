/**
 * MultipleChoiceMode — MCQ interaction mode for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx. Uses buildMCQOptions from logic module.
 *
 * Fix #1101: always include all vocab words as distractor candidates so that even on
 * the last question — when few "unused" words remain — there are still at least 2
 * visible choices (never a forced-correct single-option question).
 *
 * Fix #1912: wrong answer now shows ✗ marker + correct answer reveal + explicit next
 * button. Adopted from step 9 (Comprehension) pattern. Silent accept removed.
 *
 * Fix #2159: wrong answer no longer reveals correct answer. Student can retry until
 * correct. Added onboarding coach + demo animation on real option buttons.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VocabItem } from '../../types';
import { buildMCQOptions, AnswerRecord } from './vocabDefinitionMatchLogic';
import { getVocabDefinitionEncouragementMessage } from '../../utils/encouragement';

// ── localStorage key for first-use onboarding gate ────────────────────────
const VOCAB_MCQ_ONBOARDED_KEY = 'vocab_mcq_onboarded';

// Hold ~1.2s after correct so students see feedback before the next question
// (matches FillInBlankExercise A10 — prevents rapid spam-clicking through).
const CORRECT_ADVANCE_DELAY_MS = 1200;

const CORRECT_PRAISES = ['答對了！', '太棒了！', '很厲害！', '完全正確！', '你答對了！'] as const;
let praiseIdx = 0;

function nextCorrectPraise(): string {
  const msg = CORRECT_PRAISES[praiseIdx % CORRECT_PRAISES.length];
  praiseIdx += 1;
  return msg;
}

export interface MultipleChoiceProps {
  vocab: VocabItem[];
  activeDefIndices: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
  /**
   * #2839 — 已作答的快照，用來「接著答」而不是從第 1 題重來。
   */
  initialAnswers?: AnswerRecord[];
  /**
   * #2839 — 每答一題回報一次。
   *
   * 這個 callback 之前不存在，是這一關進度存不進 DB 的根因：每一題的作答只寫進
   * `answersRef`（useRef，不觸發 render、不通知 parent），parent 要等到 11 題全部
   * 答完的 `onAllDone` 才知道任何事。作答中 parent 的 `mcAnswers` 恆為 `[]`，
   * 進度 payload 每次算出來都一模一樣，dedup 正確地判定沒變化 → 一次 PUT 都不發。
   */
  onAnswersChange?: (answers: AnswerRecord[]) => void;
}

/**
 * 把還原回來的作答對回目前這一輪的題目集合。用 `defIndex` 對，不是用陣列位置 ——
 * 「重做錯題」會讓 `activeDefIndices` 只剩一部分，位置對不起來。
 */
function seedAnswers(activeDefIndices: number[], restored?: AnswerRecord[]): AnswerRecord[] {
  const byDefIndex = new Map((restored ?? []).map((a) => [a.defIndex, a]));
  return activeDefIndices.map(
    (defIdx) =>
      byDefIndex.get(defIdx) ?? {
        defIndex: defIdx,
        answeredWordIdx: null,
        correct: null,
        firstTryCorrect: null,
      },
  );
}

/** 還原後該從第幾題接著答 —— 第一個還沒作答的。全部答完就停在最後一題。 */
function resumeQueueIdx(answers: AnswerRecord[]): number {
  const idx = answers.findIndex((a) => a.answeredWordIdx === null);
  if (idx !== -1) return idx;
  return Math.max(0, answers.length - 1);
}

// AnswerState now tracks all wrong choices for the current question so
// multiple wrong attempts can all be marked red simultaneously.
type AnswerState =
  | { status: 'idle' }
  | { status: 'correct'; chosenIdx: number }
  | { status: 'wrong'; wrongIndices: Set<number> };

// ── Demo step tooltip bubble ───────────────────────────────────────────────
function DemoBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex justify-center animate-in fade-in slide-in-from-bottom-2 duration-300"
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

type DemoStep = 'read-def' | 'pick' | 'click' | 'success';

interface DemoRuntime {
  step: DemoStep;
  targetIdx: number;
}

// ── Onboarding coach (amber box, matches ReadingAnnotation pattern) ────────
interface OnboardingCoachProps {
  onDismiss: () => void;
  onDemo: () => void;
}

function OnboardingCoach({ onDismiss, onDemo }: OnboardingCoachProps) {
  return (
    <div className="mb-5 rounded-2xl border-2 border-amber-400/60 bg-amber-50 px-5 py-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-amber-500 text-2xl flex-shrink-0 mt-0.5">
          lightbulb
        </span>
        <div className="flex-1">
          <p className="font-bold text-on-surface text-base mb-1">詞語理解怎麼玩？</p>
          <p className="text-sm text-on-surface-variant leading-relaxed">
            讀上方的解釋，從下面的選項中選出對應的語詞。
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

export function MultipleChoiceMode({
  vocab,
  activeDefIndices,
  onAllDone,
  initialAnswers,
  onAnswersChange,
}: MultipleChoiceProps) {
  const answersRef = useRef<AnswerRecord[]>(seedAnswers(activeDefIndices, initialAnswers));
  const [queueIdx, setQueueIdx] = useState(() => resumeQueueIdx(answersRef.current));
  const [answerState, setAnswerState] = useState<AnswerState>({ status: 'idle' });
  const [correctPraise, setCorrectPraise] = useState('答對了！');
  const [wrongEncouragement, setWrongEncouragement] = useState('加油！再想想看');
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Onboarding state — gated by localStorage
  const [showCoach, setShowCoach] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(VOCAB_MCQ_ONBOARDED_KEY);
    } catch {
      return true;
    }
  });

  // Guided demo: step-by-step tooltips + animated tap on the correct option (visual only)
  const [demo, setDemo] = useState<DemoRuntime | null>(null);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // 題目集合換了（重做錯題 / 全部重做 / 切換模式）→ 從頭開始。
  //
  // #2839：這個 effect 在 mount 時也會跑一次，會把上面剛從 `initialAnswers` 種好的
  // 快照整個抹掉 —— 還原就永遠不會生效，而且不會有任何錯誤，看起來就只是「沒還原」。
  // 所以第一次跑要跳過：mount 當下的種子已經是對的了。
  const didResetOnceRef = useRef(false);
  useEffect(() => {
    if (!didResetOnceRef.current) {
      didResetOnceRef.current = true;
      return;
    }
    setQueueIdx(0);
    setAnswerState({ status: 'idle' });
    setCorrectPraise('答對了！');
    setWrongEncouragement('加油！再想想看');
    answersRef.current = seedAnswers(activeDefIndices);
  }, [activeDefIndices]);

  const clearDemoTimers = () => {
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    demoTimersRef.current.forEach((id) => clearTimeout(id));
    demoTimersRef.current = [];
    demoTimerRef.current = null;
  };

  // Clean up demo + advance timers on unmount
  useEffect(() => {
    return () => {
      clearDemoTimers();
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const currentDefIdx = activeDefIndices[queueIdx];

  const options = useMemo(
    () => buildMCQOptions(vocab, currentDefIdx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueIdx, currentDefIdx, vocab],
  );

  const handleDismissCoach = () => {
    setShowCoach(false);
    try {
      localStorage.setItem(VOCAB_MCQ_ONBOARDED_KEY, '1');
    } catch {
      // ignore
    }
  };

  const scheduleDemoStep = (fn: () => void, delayMs: number) => {
    const id = setTimeout(fn, delayMs);
    demoTimersRef.current.push(id);
    return id;
  };

  /**
   * Guided demo on the real UI — tooltips + animated tap on the correct option.
   * Purely visual — does NOT submit an answer or affect scoring.
   *   0ms    → tooltip: read definition
   *   1400ms → tooltip: pick from options
   *   2800ms → animated finger + highlight on correct option
   *   4200ms → show success state
   *   5600ms → done
   */
  const handleDemo = () => {
    clearDemoTimers();
    handleDismissCoach();

    const targetIdx = currentDefIdx;
    setDemo({ step: 'read-def', targetIdx });

    scheduleDemoStep(() => setDemo({ step: 'pick', targetIdx }), 1400);
    scheduleDemoStep(() => setDemo({ step: 'click', targetIdx }), 2800);
    scheduleDemoStep(() => setDemo({ step: 'success', targetIdx }), 4200);
    scheduleDemoStep(() => setDemo(null), 5600);
  };

  const handleChoice = (vocabIdx: number) => {
    // Ignore clicks while correct answer is showing (auto-advance in progress)
    if (answerState.status === 'correct') return;
    // Ignore clicks on already-wrong options (but allow clicking other options)
    if (answerState.status === 'wrong' && answerState.wrongIndices.has(vocabIdx)) return;

    const isCorrect = vocabIdx === currentDefIdx;

    // Update the answers record — `correct`/`answeredWordIdx` reflect the
    // LATEST attempt on purpose (on retry, overwrite). `firstTryCorrect` and
    // `firstTryAnsweredWordIdx` are write-once (#2773): captured only on the
    // item's first attempt (while `firstTryCorrect` is still null), then never
    // touched again — a retry-into-correct can't erase the original miss, and
    // "你選了 X" can't end up showing the later CORRECT pick on both sides.
    answersRef.current = answersRef.current.map((a) => {
      if (a.defIndex !== currentDefIdx) return a;
      const isFirstAttempt = a.firstTryCorrect == null;
      return {
        ...a,
        answeredWordIdx: vocabIdx,
        correct: isCorrect,
        firstTryCorrect: isFirstAttempt ? isCorrect : a.firstTryCorrect,
        firstTryAnsweredWordIdx: isFirstAttempt
          ? (isCorrect ? null : vocabIdx)
          : a.firstTryAnsweredWordIdx ?? null,
      };
    });

    // #2839 — 每一題都回報，答對答錯都要。少了這行，作答中的答案只活在 ref 裡，
    // parent 的進度 payload 從頭到尾不會變，PUT 一次都不會送出去。
    onAnswersChange?.(answersRef.current);

    if (isCorrect) {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      setCorrectPraise(nextCorrectPraise());
      setAnswerState({ status: 'correct', chosenIdx: vocabIdx });
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        setAnswerState({ status: 'idle' });
        const nextIdx = queueIdx + 1;
        if (nextIdx >= activeDefIndices.length) {
          onAllDone(answersRef.current);
        } else {
          setQueueIdx(nextIdx);
        }
      }, CORRECT_ADVANCE_DELAY_MS);
    } else {
      // Wrong answer: mark only the chosen option red; do NOT reveal correct answer.
      // Student can keep clicking other options.
      const prevWrong =
        answerState.status === 'wrong' ? new Set(answerState.wrongIndices) : new Set<number>();
      prevWrong.add(vocabIdx);
      const isFirstWrongOnQuestion = answerState.status !== 'wrong';
      setAnswerState({ status: 'wrong', wrongIndices: prevWrong });
      if (isFirstWrongOnQuestion) {
        setWrongEncouragement(getVocabDefinitionEncouragementMessage());
      }
    }
  };

  const item = vocab[currentDefIdx];

  const getButtonClass = (vocabIdx: number): string => {
    const base =
      'rounded-2xl border-2 p-4 flex items-center justify-center font-bold text-xl transition-all duration-200 select-none active:scale-[0.97] min-h-[56px]';

    // Guided demo — highlight correct option during click / success steps
    if (demo && vocabIdx === demo.targetIdx) {
      if (demo.step === 'success') {
        return `${base} border-emerald-400 bg-emerald-50 text-emerald-800 scale-[0.97]`;
      }
      if (demo.step === 'click') {
        return `${base} border-amber-400 bg-amber-50 text-amber-800 ring-4 ring-amber-300/60 scale-[0.97]`;
      }
    }

    // Correct answer confirmed — show green
    if (answerState.status === 'correct' && vocabIdx === answerState.chosenIdx) {
      return `${base} border-emerald-400 bg-emerald-50 text-emerald-800`;
    }

    // Wrong attempt on this specific option — red. Others remain interactive.
    if (answerState.status === 'wrong' && answerState.wrongIndices.has(vocabIdx)) {
      return `${base} border-red-400 bg-red-50 text-red-700`;
    }

    // Default interactive style
    return `${base} border-surface-container-high bg-surface-container-lowest text-on-surface hover:border-accent hover:bg-accent/5`;
  };

  return (
    <div className="max-w-2xl mx-auto px-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-2.5 bg-surface-container-high rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${activeDefIndices.length > 0 ? (queueIdx / activeDefIndices.length) * 100 : 0}%`,
            }}
          />
        </div>
        <span className="text-sm font-headline font-bold text-on-surface-variant shrink-0">
          {queueIdx + 1} / {activeDefIndices.length}
        </span>
      </div>

      {/* Onboarding coach — shown first time or when student clicks help */}
      {showCoach && <OnboardingCoach onDismiss={handleDismissCoach} onDemo={handleDemo} />}

      {/* Definition card */}
      <div className="mb-3">
        {demo?.step === 'read-def' && (
          <DemoBubble>① 先讀上方的解釋，想想是哪個語詞</DemoBubble>
        )}
      </div>
      <div
        className={`bg-surface-container-lowest rounded-3xl shadow-editorial p-8 mb-6 transition-all duration-300 ${
          demo?.step === 'read-def' ? 'ring-4 ring-amber-300/50' : ''
        }`}
      >
        <p className="text-xl md:text-2xl text-on-surface leading-[2.5rem] md:leading-[3rem]">
          {item?.definition}
        </p>
      </div>

      {/* Options — 2-column grid */}
      {/* Fix #1101 (字置中): flex items-center justify-center ensures the Chinese
          character is vertically and horizontally centered within the min-h button */}
      <div className="mb-3">
        {demo?.step === 'pick' && (
          <DemoBubble>② 從下面選出對應的語詞</DemoBubble>
        )}
        {(demo?.step === 'click' || demo?.step === 'success') && (
          <DemoBubble>
            {demo.step === 'click' ? '③ 點一下選擇答案' : '✓ 答對了！就是這樣玩'}
          </DemoBubble>
        )}
      </div>
      <div
        className={`grid grid-cols-2 gap-3 transition-all duration-300 ${
          demo?.step === 'pick' ? 'ring-4 ring-amber-300/40 rounded-2xl p-1' : ''
        }`}
      >
        {options.map((vocabIdx) => (
          <button
            key={vocabIdx}
            className={`relative ${getButtonClass(vocabIdx)}`}
            onClick={() => handleChoice(vocabIdx)}
            // Disable during guided demo or while correct answer auto-advances
            disabled={answerState.status === 'correct' || demo !== null}
          >
            {demo?.step === 'click' && vocabIdx === demo.targetIdx && (
              <span
                className="absolute -top-9 left-1/2 -translate-x-1/2 text-2xl animate-bounce pointer-events-none"
                aria-hidden
              >
                👆
              </span>
            )}
            {demo?.step === 'success' && vocabIdx === demo.targetIdx && (
              <span className="mr-1 text-emerald-600" aria-hidden="true">
                ✓
              </span>
            )}
            {/* Confirmed correct answer ✓ marker */}
            {answerState.status === 'correct' && vocabIdx === answerState.chosenIdx && (
              <span className="mr-1 text-emerald-600" aria-hidden="true">
                ✓
              </span>
            )}
            {/* Wrong-answer ✗ marker — only on the chosen wrong option */}
            {answerState.status === 'wrong' && answerState.wrongIndices.has(vocabIdx) && (
              <span
                className="mr-1 text-red-600"
                aria-label="答錯了"
                data-testid="wrong-answer-indicator"
              >
                ✗
              </span>
            )}
            {vocab[vocabIdx]?.word}
          </button>
        ))}
      </div>

      {/* Correct-answer praise — visible during hold before auto-advance */}
      {answerState.status === 'correct' && (
        <div className="mt-5 rounded-2xl bg-emerald-50 border border-emerald-200 px-5 py-3 text-center">
          <span className="material-symbols-outlined text-emerald-600 text-2xl">check_circle</span>
          <p className="text-sm font-headline font-bold text-emerald-700 mt-1">{correctPraise}</p>
        </div>
      )}

      {/* Wrong-answer encouragement panel — no answer reveal (#2159) */}
      {answerState.status === 'wrong' && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-700 font-bold text-sm">
            <span aria-hidden="true" className="text-lg">
              💪
            </span>
            <span>{wrongEncouragement}</span>
          </div>
        </div>
      )}

      {/* Show help button after onboarding is dismissed */}
      {!showCoach && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setShowCoach(true)}
            className="text-xs text-on-surface-variant/60 hover:text-on-surface-variant transition-colors flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">help_outline</span>
            怎麼玩？
          </button>
        </div>
      )}
    </div>
  );
}

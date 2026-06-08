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
import { getEncouragementMessage } from '../../utils/encouragement';

// ── localStorage key for first-use onboarding gate ────────────────────────
const VOCAB_MCQ_ONBOARDED_KEY = 'vocab_mcq_onboarded';

export interface MultipleChoiceProps {
  vocab: VocabItem[];
  activeDefIndices: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
}

// AnswerState now tracks all wrong choices for the current question so
// multiple wrong attempts can all be marked red simultaneously.
type AnswerState =
  | { status: 'idle' }
  | { status: 'correct'; chosenIdx: number }
  | { status: 'wrong'; wrongIndices: Set<number> };

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

export function MultipleChoiceMode({ vocab, activeDefIndices, onAllDone }: MultipleChoiceProps) {
  const [queueIdx, setQueueIdx] = useState(0);
  const answersRef = useRef<AnswerRecord[]>(
    activeDefIndices.map((defIdx) => ({ defIndex: defIdx, answeredWordIdx: null, correct: null })),
  );
  const [answerState, setAnswerState] = useState<AnswerState>({ status: 'idle' });

  // Onboarding state — gated by localStorage
  const [showCoach, setShowCoach] = useState<boolean>(() => {
    try {
      return !localStorage.getItem(VOCAB_MCQ_ONBOARDED_KEY);
    } catch {
      return true;
    }
  });

  // Demo animation state: null = not running, number = vocabIdx being highlighted
  const [demoHighlight, setDemoHighlight] = useState<number | null>(null);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Encouragement message picked once per wrong answer
  const [encouragementMsg, setEncouragementMsg] = useState<string>('');

  useEffect(() => {
    setQueueIdx(0);
    setAnswerState({ status: 'idle' });
    setEncouragementMsg('');
    answersRef.current = activeDefIndices.map((defIdx) => ({
      defIndex: defIdx,
      answeredWordIdx: null,
      correct: null,
    }));
  }, [activeDefIndices]);

  // Clean up demo timer on unmount
  useEffect(() => {
    return () => {
      if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
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

  /**
   * Demo animation: animate a cursor-like highlight onto the correct option.
   * Purely visual — does NOT submit an answer or affect scoring.
   * Steps:
   *   0ms   → start highlight on correct option
   *   900ms → pulse off (clear highlight)
   *   1100ms → second pulse
   *   2000ms → done
   */
  const handleDemo = () => {
    if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    setDemoHighlight(currentDefIdx);
    demoTimerRef.current = setTimeout(() => {
      setDemoHighlight(null);
      demoTimerRef.current = setTimeout(() => {
        setDemoHighlight(currentDefIdx);
        demoTimerRef.current = setTimeout(() => {
          setDemoHighlight(null);
        }, 900);
      }, 200);
    }, 900);
    // Also dismiss the coach so student can act
    handleDismissCoach();
  };

  const handleChoice = (vocabIdx: number) => {
    // Ignore clicks while correct answer is showing (auto-advance in progress)
    if (answerState.status === 'correct') return;
    // Ignore clicks on already-wrong options (but allow clicking other options)
    if (answerState.status === 'wrong' && answerState.wrongIndices.has(vocabIdx)) return;

    const isCorrect = vocabIdx === currentDefIdx;

    // Update the answers record — on retry, overwrite with the latest attempt
    answersRef.current = answersRef.current.map((a) =>
      a.defIndex === currentDefIdx
        ? { ...a, answeredWordIdx: vocabIdx, correct: isCorrect }
        : a,
    );

    if (isCorrect) {
      setAnswerState({ status: 'correct', chosenIdx: vocabIdx });
      setEncouragementMsg('');
      // Auto-advance after short delay on correct answer (step 9 pattern)
      setTimeout(() => {
        setAnswerState({ status: 'idle' });
        setEncouragementMsg('');
        const nextIdx = queueIdx + 1;
        if (nextIdx >= activeDefIndices.length) {
          onAllDone(answersRef.current);
        } else {
          setQueueIdx(nextIdx);
        }
      }, 400);
    } else {
      // Wrong answer: mark only the chosen option red; do NOT reveal correct answer.
      // Student can keep clicking other options.
      const prevWrong =
        answerState.status === 'wrong' ? new Set(answerState.wrongIndices) : new Set<number>();
      prevWrong.add(vocabIdx);
      setAnswerState({ status: 'wrong', wrongIndices: prevWrong });
      setEncouragementMsg(getEncouragementMessage());
    }
  };

  const item = vocab[currentDefIdx];

  const getButtonClass = (vocabIdx: number): string => {
    const base =
      'rounded-2xl border-2 p-4 flex items-center justify-center font-bold text-xl transition-all duration-200 select-none active:scale-[0.97] min-h-[56px]';

    // Demo highlight overrides everything — amber pulsing style
    if (demoHighlight === vocabIdx) {
      return `${base} border-amber-400 bg-amber-50 text-amber-800 animate-pulse`;
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
      <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 mb-6">
        <p className="text-xl md:text-2xl text-on-surface leading-[2.5rem] md:leading-[3rem]">
          {item?.definition}
        </p>
      </div>

      {/* Options — 2-column grid */}
      {/* Fix #1101 (字置中): flex items-center justify-center ensures the Chinese
          character is vertically and horizontally centered within the min-h button */}
      <div className="grid grid-cols-2 gap-3">
        {options.map((vocabIdx) => (
          <button
            key={vocabIdx}
            className={getButtonClass(vocabIdx)}
            onClick={() => handleChoice(vocabIdx)}
            // Only disable when correct answer is being processed (auto-advance delay)
            // or during demo highlight — wrong answers keep buttons interactive
            disabled={answerState.status === 'correct' || demoHighlight !== null}
          >
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

      {/* Wrong-answer encouragement panel — no answer reveal (#2159) */}
      {answerState.status === 'wrong' && (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-700 font-bold text-sm">
            <span aria-hidden="true" className="text-lg">
              💪
            </span>
            <span>{encouragementMsg || '答錯了，再試試看！'}</span>
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

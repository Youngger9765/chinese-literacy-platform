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
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VocabItem } from '../../types';
import { buildMCQOptions, AnswerRecord } from './vocabDefinitionMatchLogic';

export interface MultipleChoiceProps {
  vocab: VocabItem[];
  activeDefIndices: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
}

type AnswerState =
  | { status: 'idle' }
  | { status: 'correct'; chosenIdx: number }
  | { status: 'wrong'; chosenIdx: number };

export function MultipleChoiceMode({ vocab, activeDefIndices, onAllDone }: MultipleChoiceProps) {
  const [queueIdx, setQueueIdx] = useState(0);
  const answersRef = useRef<AnswerRecord[]>(
    activeDefIndices.map((defIdx) => ({ defIndex: defIdx, answeredWordIdx: null, correct: null })),
  );
  const [answerState, setAnswerState] = useState<AnswerState>({ status: 'idle' });

  useEffect(() => {
    setQueueIdx(0);
    setAnswerState({ status: 'idle' });
    answersRef.current = activeDefIndices.map((defIdx) => ({
      defIndex: defIdx,
      answeredWordIdx: null,
      correct: null,
    }));
  }, [activeDefIndices]);

  const currentDefIdx = activeDefIndices[queueIdx];

  const options = useMemo(
    () => buildMCQOptions(vocab, currentDefIdx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueIdx, currentDefIdx, vocab],
  );

  const handleChoice = (vocabIdx: number) => {
    if (answerState.status !== 'idle') return;

    const isCorrect = vocabIdx === currentDefIdx;

    answersRef.current = answersRef.current.map((a) =>
      a.defIndex === currentDefIdx
        ? { ...a, answeredWordIdx: vocabIdx, correct: isCorrect }
        : a,
    );

    if (isCorrect) {
      setAnswerState({ status: 'correct', chosenIdx: vocabIdx });
      // Auto-advance after short delay on correct answer (step 9 pattern)
      setTimeout(() => {
        setAnswerState({ status: 'idle' });
        const nextIdx = queueIdx + 1;
        if (nextIdx >= activeDefIndices.length) {
          onAllDone(answersRef.current);
        } else {
          setQueueIdx(nextIdx);
        }
      }, 400);
    } else {
      // Wrong answer: show ✗ + correct reveal + explicit next button (fix #1912)
      setAnswerState({ status: 'wrong', chosenIdx: vocabIdx });
    }
  };

  const handleNext = () => {
    setAnswerState({ status: 'idle' });
    const nextIdx = queueIdx + 1;
    if (nextIdx >= activeDefIndices.length) {
      onAllDone(answersRef.current);
    } else {
      setQueueIdx(nextIdx);
    }
  };

  const item = vocab[currentDefIdx];
  const isAnswered = answerState.status !== 'idle';

  const getButtonClass = (vocabIdx: number): string => {
    const base = 'rounded-2xl border-2 p-4 flex items-center justify-center font-bold text-xl transition-all duration-200 select-none active:scale-[0.97] min-h-[56px]';
    if (!isAnswered) {
      return `${base} border-surface-container-high bg-surface-container-lowest text-on-surface hover:border-accent hover:bg-accent/5`;
    }
    if (vocabIdx === currentDefIdx) {
      // Correct answer — highlight green
      return `${base} border-emerald-400 bg-emerald-50 text-emerald-800`;
    }
    if (answerState.status === 'wrong' && vocabIdx === answerState.chosenIdx) {
      // Chosen wrong answer — highlight red
      return `${base} border-red-400 bg-red-50 text-red-700`;
    }
    // Other options — muted
    return `${base} border-surface-container-high bg-surface-container-lowest text-on-surface opacity-40`;
  };

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
      {/* Fix #1101 (字置中): flex items-center justify-center ensures the Chinese
          character is vertically and horizontally centered within the min-h button */}
      <div className="grid grid-cols-2 gap-3">
        {options.map((vocabIdx) => (
          <button
            key={vocabIdx}
            className={getButtonClass(vocabIdx)}
            onClick={() => handleChoice(vocabIdx)}
            disabled={isAnswered}
          >
            {/* Wrong-answer ✗ marker (#1912) */}
            {answerState.status === 'wrong' && vocabIdx === answerState.chosenIdx && (
              <span
                className="mr-1 text-red-600"
                aria-label="錯誤"
                data-testid="wrong-answer-indicator"
              >
                ✗
              </span>
            )}
            {/* Correct answer ✓ marker */}
            {isAnswered && vocabIdx === currentDefIdx && (
              <span className="mr-1 text-emerald-600" aria-hidden="true">✓</span>
            )}
            {vocab[vocabIdx]?.word}
          </button>
        ))}
      </div>

      {/* Wrong-answer feedback panel (#1912) */}
      {answerState.status === 'wrong' && (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-red-700 font-bold text-sm">
            <span aria-hidden="true">✗</span>
            <span>答錯了，正確答案是：</span>
            <span className="text-red-800 font-bold text-base">{vocab[currentDefIdx]?.word}</span>
          </div>
          {vocab[currentDefIdx]?.definition && (
            <p className="text-sm text-red-600 leading-relaxed">
              💡 {vocab[currentDefIdx].definition}
            </p>
          )}
          <button
            type="button"
            onClick={handleNext}
            className="mt-1 px-5 py-2 rounded-full text-sm font-bold bg-accent text-white hover:bg-accent-hover transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
          >
            繼續下一題
          </button>
        </div>
      )}
    </div>
  );
}

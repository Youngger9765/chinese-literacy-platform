/**
 * MultipleChoiceMode — MCQ interaction mode for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx. Uses buildMCQOptions from logic module.
 *
 * Fix #1101: always include all vocab words as distractor candidates so that even on
 * the last question — when few "unused" words remain — there are still at least 2
 * visible choices (never a forced-correct single-option question).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VocabItem } from '../../types';
import { buildMCQOptions, AnswerRecord } from './vocabDefinitionMatchLogic';

export interface MultipleChoiceProps {
  vocab: VocabItem[];
  activeDefIndices: number[];
  onAllDone: (answers: AnswerRecord[]) => void;
}

export function MultipleChoiceMode({ vocab, activeDefIndices, onAllDone }: MultipleChoiceProps) {
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

  const options = useMemo(
    () => buildMCQOptions(vocab, currentDefIdx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queueIdx, currentDefIdx, vocab],
  );

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
      {/* Fix #1101 (字置中): flex items-center justify-center ensures the Chinese
          character is vertically and horizontally centered within the min-h button */}
      <div className="grid grid-cols-2 gap-3">
        {options.map((vocabIdx) => (
          <button
            key={vocabIdx}
            className="rounded-2xl border-2 p-4 flex items-center justify-center font-bold text-xl transition-all duration-200 select-none active:scale-[0.97] min-h-[56px] border-surface-container-high bg-surface-container-lowest text-on-surface hover:border-accent hover:bg-accent/5 disabled:opacity-50"
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

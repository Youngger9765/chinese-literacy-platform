/**
 * ChoiceInput — single-select (radio) widget for multiple_choice + answerSpace 'choice'.
 *
 * Emits the selected option INDEX (number) — the same runtime shape as the exercise's
 * index-based `answer`, so `grade()` compares index === answer (exact). Letter answers
 * (wen-L2 vocab_bank "A") are normalized to index by the adapter/grader, never here.
 *
 * Visual pattern lifted from BlockSequenceRenderer's 'single' block + the physical
 * worksheet ABCD badge (matches MultipleChoiceExercise).
 */
import React from 'react';

interface Props {
  options: string[];
  /** Currently selected index, or null. */
  value: number | null;
  onChange: (index: number) => void;
  disabled?: boolean;
  /** Feedback verdict once submitted (true/false), or null while unanswered. */
  verdict?: boolean | null;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const ChoiceInput: React.FC<Props> = ({ options, value, onChange, disabled, verdict }) => {
  const locked = disabled || (verdict !== undefined && verdict !== null);
  return (
    <div className="space-y-2" role="radiogroup">
      {options.map((opt, oi) => {
        const selected = value === oi;
        return (
          <button
            key={oi}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={locked}
            onClick={() => onChange(oi)}
            className={[
              'w-full text-left rounded-lg border px-4 py-3 text-lg leading-relaxed transition-colors flex items-start gap-2',
              selected
                ? 'border-violet-500 bg-violet-50 text-violet-900'
                : 'border-gray-200 hover:border-violet-300',
              locked ? 'cursor-default' : '',
            ].join(' ')}
          >
            <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border border-current text-xs font-bold">
              {LETTERS[oi] ?? oi + 1}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{opt}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ChoiceInput;

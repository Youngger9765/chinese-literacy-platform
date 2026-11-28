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
  /** #3621: same length/index as `options`. A handful of comprehension
   *  options are a DRAWING, not text ("下列哪一張圖…") — the source
   *  worksheet's correct answer has no caption, so `options[i]` can be ""
   *  while `images[i]` carries the asset URL to render instead. Absent for
   *  plain text-only questions. */
  images?: (string | null)[] | null;
  /** Currently selected index, or null. */
  value: number | null;
  onChange: (index: number) => void;
  disabled?: boolean;
  /** Feedback verdict once submitted (true/false), or null while unanswered. */
  verdict?: boolean | null;
  /** #4154: 每個選項下方的一句說明，同 `options` 順序；該格為 null 就不畫。 */
  explanations?: (string | null)[] | null;
  /** #4154: 說明攤開時，哪一格是正解（正解那句用綠字）。答錯時不傳，不公布答案。 */
  answerIndex?: number | null;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const ChoiceInput: React.FC<Props> = ({
  options,
  images,
  value,
  onChange,
  disabled,
  verdict,
  explanations,
  answerIndex,
}) => {
  const locked = disabled || (verdict !== undefined && verdict !== null);
  return (
    <div className="space-y-2" role="radiogroup">
      {options.map((opt, oi) => {
        const selected = value === oi;
        const explanation = explanations?.[oi] ?? null;
        return (
          <div key={oi} className="space-y-1">
          <button
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
            {images?.[oi] && (
              <img
                src={images[oi] as string}
                alt={`選項 ${LETTERS[oi] ?? oi + 1}`}
                loading="lazy"
                className="h-24 w-24 sm:h-32 sm:w-32 object-contain rounded-md border border-gray-200 bg-white shrink-0"
              />
            )}
            {opt && <span className="flex-1 whitespace-pre-wrap">{opt}</span>}
          </button>
          {explanation ? (
            <p
              data-testid={`choice-explanation-${LETTERS[oi] ?? oi + 1}`}
              className={`ml-8 text-base leading-relaxed ${
                answerIndex === oi ? 'text-green-700' : 'text-gray-600'
              }`}
            >
              {explanation}
            </p>
          ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default ChoiceInput;

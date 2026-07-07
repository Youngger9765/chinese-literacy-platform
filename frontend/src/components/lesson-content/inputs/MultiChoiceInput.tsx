/**
 * MultiChoiceInput — multi-select (checkbox) widget for multiple_choice +
 * answerSpace 'multi_choice' (grader 'set'). G5 ex-multi answer:[0,2,3].
 *
 * Emits an array of selected INDICES (number[]) — the same runtime shape as the
 * exercise's index-set `answer`, so `grade()` does set-equality (order-insensitive).
 * Today's frontend downgrades 複選 to free_text; here it is a first-class widget.
 */
import React from 'react';

interface Props {
  options: string[];
  /** Currently selected indices. */
  value: number[];
  onChange: (indices: number[]) => void;
  disabled?: boolean;
  verdict?: boolean | null;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const MultiChoiceInput: React.FC<Props> = ({ options, value, onChange, disabled, verdict }) => {
  const locked = disabled || (verdict !== undefined && verdict !== null);
  const toggle = (oi: number) => {
    if (value.includes(oi)) onChange(value.filter((x) => x !== oi));
    else onChange([...value, oi].sort((a, b) => a - b));
  };
  return (
    <div className="space-y-2">
      {options.map((opt, oi) => {
        const selected = value.includes(oi);
        return (
          <label
            key={oi}
            className={[
              'w-full text-left rounded-lg border px-4 py-2.5 text-base transition-colors flex items-start gap-3 cursor-pointer',
              selected
                ? 'border-violet-500 bg-violet-50 text-violet-900'
                : 'border-gray-200 hover:border-violet-300',
              locked ? 'cursor-default opacity-90' : '',
            ].join(' ')}
          >
            <input
              type="checkbox"
              checked={selected}
              disabled={locked}
              onChange={() => toggle(oi)}
              className="mt-1 shrink-0"
            />
            <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border border-current text-xs font-bold">
              {LETTERS[oi] ?? oi + 1}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{opt}</span>
          </label>
        );
      })}
    </div>
  );
};

export default MultiChoiceInput;

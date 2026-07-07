/**
 * TraitInput — 推論人物特質 widget for the `trait_inference` kind (grader 'exact').
 *
 * Emits the selected trait-option INDEX (number) — same shape as the exercise's
 * index `answer` (G5 ex-trait answer:0). Grading is index-based. Visual pattern
 * (clue list + option grid) mirrors the legacy TraitInferenceExercise.
 */
import React from 'react';

interface Props {
  character: string;
  instruction: string;
  clues: string[];
  traitOptions: string[];
  value: number | null;
  onChange: (index: number) => void;
  disabled?: boolean;
  verdict?: boolean | null;
}

const TraitInput: React.FC<Props> = ({
  character,
  instruction,
  clues,
  traitOptions,
  value,
  onChange,
  disabled,
  verdict,
}) => {
  const locked = disabled || (verdict !== undefined && verdict !== null);
  return (
    <div className="space-y-4">
      <p className="text-base text-on-surface whitespace-pre-wrap">{instruction}</p>
      {clues.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 mb-2">
            {character}的言行線索
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-amber-900">
            {clues.map((clue, i) => (
              <li key={i}>{clue}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="人物特質選項">
        {traitOptions.map((opt, oi) => {
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
                'rounded-lg border px-4 py-3 text-base font-medium transition-colors',
                selected
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-gray-200 hover:border-violet-300',
                locked ? 'cursor-default' : '',
              ].join(' ')}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TraitInput;

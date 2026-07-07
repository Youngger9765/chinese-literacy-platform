/**
 * FillInBlankInput — the `fill_in_blank` kind, three shapes (Gap 3):
 *
 *   (i)  block list answer + grader 'set' (G5 ex-fill [自律,謙虛], any-order):
 *        split the sentence's blanks, render one text input per blank, emit a
 *        string[] (order-insensitive graded).
 *   (ii) per-slot `slots[]`, each with its own id + grader exact|set (G5 ex-fill-slots
 *        b1 exact / b2 set): render one input per slot, emit a dict {slotId: value}.
 *   (iii) choice-style + vocabBank + answerSpace 'choice' + letter answer
 *        (wen-L2 ex-vocab-si "A"): render the vocabBank options as radios, emit the
 *        selected INDEX. (ChoiceInput handles the widget; this branch adapts vocabBank.)
 *
 * Blank splitting reuses FillInBlankExercise's `__` / （　） split idea. Emitted value
 * shapes are exactly what `grade()` consumes per shape.
 */
import React from 'react';
import ChoiceInput from './ChoiceInput';

export type FillShape = 'set-list' | 'slots' | 'vocab-choice';

interface SlotDef {
  id: string;
  hint?: string | null;
}

interface Props {
  shape: FillShape;
  sentence: string;
  disabled?: boolean;
  verdict?: boolean | null;

  // set-list
  listValue?: string[];
  onListChange?: (values: string[]) => void;
  blankCount?: number;

  // slots
  slots?: SlotDef[];
  slotValue?: Record<string, string>;
  onSlotChange?: (values: Record<string, string>) => void;

  // vocab-choice
  vocabOptions?: string[];
  choiceValue?: number | null;
  onChoiceChange?: (index: number) => void;
}

/** Count blanks in a sentence: `__`(one or more underscores) or （　）full-width gaps. */
export function countBlanks(sentence: string): number {
  const m = sentence.match(/_+|[（(][　\s]*[）)]/g);
  return m ? m.length : 1;
}

/** Split a sentence into text parts around each blank marker. parts.length = blanks+1. */
export function splitSentence(sentence: string): string[] {
  return sentence.split(/_+|[（(][　\s]*[）)]/);
}

const FillInBlankInput: React.FC<Props> = (props) => {
  const {
    shape,
    sentence,
    disabled,
    verdict,
  } = props;
  const locked = disabled || (verdict !== undefined && verdict !== null);

  if (shape === 'vocab-choice') {
    const options = props.vocabOptions ?? [];
    return (
      <div className="space-y-3">
        <p className="text-base text-on-surface whitespace-pre-wrap">{sentence}</p>
        <ChoiceInput
          options={options}
          value={props.choiceValue ?? null}
          onChange={(i) => props.onChoiceChange?.(i)}
          disabled={locked}
          verdict={verdict}
        />
      </div>
    );
  }

  if (shape === 'slots') {
    const slots = props.slots ?? [];
    const slotValue = props.slotValue ?? {};
    return (
      <div className="space-y-3">
        <p className="text-base text-on-surface whitespace-pre-wrap">{sentence}</p>
        <div className="space-y-2">
          {slots.map((slot, i) => (
            <div key={slot.id} className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-semibold text-on-surface-variant w-14">
                第 {i + 1} 格
              </span>
              <input
                type="text"
                value={slotValue[slot.id] ?? ''}
                disabled={locked}
                onChange={(e) =>
                  props.onSlotChange?.({ ...slotValue, [slot.id]: e.target.value })
                }
                placeholder={slot.hint ?? '填入答案'}
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-base"
                aria-label={`第 ${i + 1} 格填空`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // set-list: one input per blank, order-insensitive.
  const count = props.blankCount ?? countBlanks(sentence);
  const listValue = props.listValue ?? [];
  return (
    <div className="space-y-3">
      <p className="text-base text-on-surface whitespace-pre-wrap">{sentence}</p>
      <div className="space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-semibold text-on-surface-variant w-14">
              第 {i + 1} 格
            </span>
            <input
              type="text"
              value={listValue[i] ?? ''}
              disabled={locked}
              onChange={(e) => {
                const next = [...listValue];
                while (next.length < count) next.push('');
                next[i] = e.target.value;
                props.onListChange?.(next);
              }}
              placeholder="填入答案"
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-base"
              aria-label={`第 ${i + 1} 格填空`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default FillInBlankInput;

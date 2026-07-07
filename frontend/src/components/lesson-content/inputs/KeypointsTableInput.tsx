/**
 * KeypointsTableInput — 重點表 widget for the `keypoints_table` kind (grader 'exact').
 *
 * Renders `rows` (label/subLabel + the blanks each row references) and, per blank,
 * either a free-fill text input or a □-choice radio group (when the blank carries
 * `options`). Emits a dict {blankId: value} — the exact runtime shape of the block
 * `answer` (G7 ex-keypoints), so `grade()` compares per-blank (normalized text or
 * pick-equality) and passes only when every blank is correct.
 */
import React from 'react';
import type { Question } from '../../../schema/lessonContent';

export type KeypointsQuestion = Question & { kind: 'keypoints_table' };

interface Props {
  question: KeypointsQuestion;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
  verdict?: boolean | null;
}

const KeypointsTableInput: React.FC<Props> = ({ question, value, onChange, disabled, verdict }) => {
  const locked = disabled || (verdict !== undefined && verdict !== null);
  const blankById = new Map(question.blanks.map((b) => [b.id, b]));

  const setBlank = (id: string, v: string) => onChange({ ...value, [id]: v });

  return (
    <div className="space-y-3">
      {question.title ? (
        <p className="text-base font-semibold text-on-surface">{question.title}</p>
      ) : null}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full border-collapse border border-outline-variant text-sm md:text-base">
          <tbody>
            {question.rows.map((row, rIdx) => (
              <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container/40'}>
                <th className="px-3 py-2.5 text-left font-semibold text-on-surface border border-outline-variant align-top whitespace-pre-line w-1/4">
                  {row.label}
                  {row.subLabel ? (
                    <span className="block text-xs font-normal text-on-surface-variant mt-0.5">
                      {row.subLabel}
                    </span>
                  ) : null}
                </th>
                <td className="px-3 py-2.5 border border-outline-variant align-top">
                  <div className="flex flex-col gap-2">
                    {(row.blankIds ?? []).map((bid) => {
                      const blank = blankById.get(bid);
                      if (!blank) return null;
                      if (blank.options != null) {
                        // □-choice blank: radios over options.
                        return (
                          <div key={bid} className="flex flex-wrap gap-3" role="radiogroup" aria-label={blank.hint ?? bid}>
                            {blank.options.map((opt) => (
                              <label key={opt} className="inline-flex items-center gap-1.5 text-base cursor-pointer">
                                <input
                                  type="radio"
                                  name={`kp-${bid}`}
                                  checked={value[bid] === opt}
                                  disabled={locked}
                                  onChange={() => setBlank(bid, opt)}
                                />
                                <span>{opt}</span>
                              </label>
                            ))}
                          </div>
                        );
                      }
                      // free-fill blank: text input.
                      return (
                        <input
                          key={bid}
                          type="text"
                          value={value[bid] ?? ''}
                          disabled={locked}
                          onChange={(e) => setBlank(bid, e.target.value)}
                          placeholder={blank.hint ?? '填入答案'}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-base"
                          aria-label={blank.hint ?? bid}
                        />
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default KeypointsTableInput;

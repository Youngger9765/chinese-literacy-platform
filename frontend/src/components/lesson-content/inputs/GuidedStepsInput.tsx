/**
 * GuidedStepsInput — widget for `guided_steps` + `graphic_text_integration` kinds.
 *
 * Per-step widgets:
 *   - select      → radios; verdict = selectedIndex === step.answer.
 *   - multi_select→ checkboxes; verdict = set-equality vs step.answer (Gap 7: the ONE
 *                   legacy lossy point — legacy GuidedStepsExercise only did select|
 *                   free_text; here multi_select is first-class).
 *   - free_text   → textarea graded by `validateStrategyAnswer` (rubric_ai), FAIL-CLOSED
 *                   to is_correct:true (FALLBACK_GRADE) on AI error / no token — copying
 *                   BlockSequenceRenderer.tsx:110-145 (#2279: don't let AI outage block).
 *
 * The block-level list answer ([0,1,null,1,0,[1,2]]) is storage/regrade only, NOT a
 * second grading path — each step is graded by its own step.answer here. This widget
 * owns its per-step state and reports overall completion up via onAllStepsDone.
 *
 * Hooks are declared at the top level, before any effect that references them (#2279
 * TDZ gate). State setters used in effects are stable useState setters.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { validateStrategyAnswer } from '../../../services/learningApi';
import type { StrategyGradeResult } from '../../../services/learning/sentence';
import type { Question } from '../../../schema/lessonContent';
import { setEqualIndices, gradeRubricLocal } from '../lessonGrading';

export type GuidedQuestion = Question & ({ kind: 'guided_steps' } | { kind: 'graphic_text_integration' });

const FALLBACK_GRADE: StrategyGradeResult = {
  is_correct: true,
  feedback: '已記錄你的答案，做得好！',
  suggestion: '',
};

interface Props {
  question: GuidedQuestion;
  strategyName: string;
  storyTitle?: string | null;
  passage?: string | null;
  /** Per-step student answers, keyed by step index. */
  value: Record<number, unknown>;
  onChange: (value: Record<number, unknown>) => void;
  /** Fired whenever every step has a recorded answer/verdict. */
  onAllStepsDone?: (done: boolean) => void;
  disabled?: boolean;
}

const GuidedStepsInput: React.FC<Props> = ({
  question,
  strategyName,
  storyTitle,
  passage,
  value,
  onChange,
  onAllStepsDone,
  disabled,
}) => {
  const { token } = useAuth();
  const steps = question.steps;

  // Per-step submitted feedback (verdict) + free-text grade + grading flag.
  const [feedback, setFeedback] = useState<Record<number, boolean | null>>({});
  const [grades, setGrades] = useState<Record<number, StrategyGradeResult>>({});
  const [gradingStep, setGradingStep] = useState<number | null>(null);

  const allDone = useMemo(
    () => steps.every((_, i) => feedback[i] === true || feedback[i] === false),
    [steps, feedback],
  );

  useEffect(() => {
    onAllStepsDone?.(allDone);
  }, [allDone, onAllStepsDone]);

  const setStepValue = useCallback(
    (i: number, v: unknown) => onChange({ ...value, [i]: v }),
    [onChange, value],
  );

  const submitSelect = (i: number) => {
    const step = steps[i];
    const picked = value[i];
    if (typeof picked !== 'number') return;
    setFeedback((prev) => ({ ...prev, [i]: picked === step.answer }));
  };

  const submitMultiSelect = (i: number) => {
    const step = steps[i];
    const picked = value[i];
    if (!Array.isArray(picked) || picked.length === 0) return;
    setFeedback((prev) => ({ ...prev, [i]: setEqualIndices(picked, step.answer) }));
  };

  const submitFreeText = async (i: number) => {
    const step = steps[i];
    const text = String(value[i] ?? '').trim();
    if (!text) return;

    if (!token) {
      const localCorrect = gradeRubricLocal(text, step.referenceAnswer);
      setGrades((prev) => ({
        ...prev,
        [i]: { ...FALLBACK_GRADE, is_correct: localCorrect, feedback: localCorrect ? '✓ 答對了' : '再想想看' },
      }));
      setFeedback((prev) => ({ ...prev, [i]: true }));
      return;
    }

    setGradingStep(i);
    try {
      const grade = await validateStrategyAnswer(token, {
        question: step.prompt,
        studentAnswer: text,
        strategyName,
        storyTitle,
        passage,
      });
      setGrades((prev) => ({ ...prev, [i]: grade }));
      setFeedback((prev) => ({ ...prev, [i]: true }));
    } catch {
      // FAIL-CLOSED: AI outage must not block the student (#2279).
      setGrades((prev) => ({ ...prev, [i]: FALLBACK_GRADE }));
      setFeedback((prev) => ({ ...prev, [i]: true }));
    } finally {
      setGradingStep(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-base text-on-surface whitespace-pre-wrap">{question.instruction}</p>
      {steps.map((step, i) => {
        const fb = feedback[i];
        const submitted = fb === true || fb === false;
        const options = step.options ?? [];
        return (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <p className="text-base font-medium text-on-surface whitespace-pre-wrap">{step.prompt}</p>

            {step.type === 'select' && (
              <>
                <div className="space-y-2" role="radiogroup">
                  {options.map((opt, oi) => (
                    <button
                      key={oi}
                      type="button"
                      role="radio"
                      aria-checked={value[i] === oi}
                      disabled={submitted}
                      onClick={() => setStepValue(i, oi)}
                      className={[
                        'w-full text-left rounded-lg border px-4 py-2 text-base transition-colors',
                        value[i] === oi ? 'border-violet-500 bg-violet-50 text-violet-900' : 'border-gray-200 hover:border-violet-300',
                      ].join(' ')}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {!submitted ? (
                  <button
                    type="button"
                    onClick={() => submitSelect(i)}
                    disabled={typeof value[i] !== 'number' || disabled}
                    className="px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
                  >
                    確認
                  </button>
                ) : (
                  <p className={`text-base font-medium ${fb ? 'text-green-700' : 'text-amber-700'}`}>
                    {fb ? '✓ 答對了' : '再想想看'}
                  </p>
                )}
              </>
            )}

            {step.type === 'multi_select' && (
              <>
                <div className="space-y-2">
                  {options.map((opt, oi) => {
                    const picked = Array.isArray(value[i]) ? (value[i] as number[]) : [];
                    const checked = picked.includes(oi);
                    return (
                      <label key={oi} className="flex items-start gap-3 rounded-lg border border-gray-200 px-4 py-2 text-base cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={submitted}
                          onChange={() => {
                            const next = checked ? picked.filter((x) => x !== oi) : [...picked, oi].sort((a, b) => a - b);
                            setStepValue(i, next);
                          }}
                          className="mt-1"
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
                {!submitted ? (
                  <button
                    type="button"
                    onClick={() => submitMultiSelect(i)}
                    disabled={!Array.isArray(value[i]) || (value[i] as number[]).length === 0 || disabled}
                    className="px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
                  >
                    確認
                  </button>
                ) : (
                  <p className={`text-base font-medium ${fb ? 'text-green-700' : 'text-amber-700'}`}>
                    {fb ? '✓ 答對了' : '再想想看'}
                  </p>
                )}
              </>
            )}

            {step.type === 'free_text' && (
              <>
                <textarea
                  value={String(value[i] ?? '')}
                  disabled={submitted || gradingStep === i}
                  onChange={(e) => setStepValue(i, e.target.value)}
                  rows={3}
                  placeholder="請在此寫下你的答案…"
                  className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-base"
                  aria-label="自由作答"
                />
                {!submitted && gradingStep !== i ? (
                  <button
                    type="button"
                    onClick={() => void submitFreeText(i)}
                    disabled={disabled}
                    className="px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600"
                  >
                    送出
                  </button>
                ) : null}
                {gradingStep === i ? (
                  <p className="text-sm text-violet-600 font-semibold">AI 批改中…</p>
                ) : null}
                {gradingStep !== i && grades[i] ? (
                  <div className={`rounded-lg border p-3 ${grades[i].is_correct ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <p className={`text-sm font-semibold ${grades[i].is_correct ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {grades[i].is_correct ? '✓ ' : '💡 '}
                      {grades[i].feedback}
                    </p>
                    {grades[i].suggestion ? (
                      <p className="mt-1.5 text-sm text-amber-700/90">{grades[i].suggestion}</p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default GuidedStepsInput;

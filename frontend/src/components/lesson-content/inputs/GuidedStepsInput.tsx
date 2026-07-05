/**
 * GuidedStepsInput — widget for `guided_steps` + `graphic_text_integration` kinds.
 *
 * Steps are grouped into REGIONS by `step.section` (e.g. 例一 / 課文故事 / 小試身手).
 * Each region renders ONCE as a bordered block: a section header + an optional
 * worked-example `context` passage (shown a single time, not per step) + that
 * region's step cards. This keeps a worked example self-contained and stops the
 * per-step prompts from repeating the section lead-in ("例一：烏鴉喝水 …").
 *
 * Per-step widgets:
 *   - select      → radios; verdict = selectedIndex === step.answer.
 *   - multi_select→ checkboxes; verdict = set-equality vs step.answer.
 *   - free_text   → textarea graded by `validateStrategyAnswer` (rubric_ai), FAIL-CLOSED
 *                   to is_correct:true on AI error / no token (#2279: don't block student).
 *
 * The block-level list answer is storage/regrade only — each step is graded by its own
 * step.answer here. Hooks are declared top-level before any effect that references them
 * (#2279 TDZ gate).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { validateStrategyAnswer } from '../../../services/learningApi';
import type { StrategyGradeResult } from '../../../services/learning/sentence';
import type { Question } from '../../../schema/lessonContent';
import { setEqualIndices, gradeRubricLocal } from '../lessonGrading';

export type GuidedQuestion = Question & ({ kind: 'guided_steps' } | { kind: 'graphic_text_integration' });

/** A/B/C/D 字母標籤 — 與 MultipleChoiceExercise / ChoiceInput 一致的選項樣式。 */
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

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

  // Restore per-step verdicts on mount from restored answers (progress resume): a step
  // whose answer came back from saved progress should already show its ✓/再想想看 without
  // the student re-confirming. select/multi_select are re-graded deterministically vs
  // step.answer; free_text uses the offline local rubric (its original AI grade isn't
  // persisted). Runs ONCE — never re-locks a step the student is actively editing.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (Object.keys(value).length === 0) return; // nothing restored
    const fb: Record<number, boolean | null> = {};
    const gr: Record<number, StrategyGradeResult> = {};
    steps.forEach((step, i) => {
      const v = value[i];
      if (v == null) return;
      if (step.type === 'select' && typeof v === 'number') {
        fb[i] = v === step.answer;
      } else if (step.type === 'multi_select' && Array.isArray(v)) {
        fb[i] = setEqualIndices(v as number[], step.answer);
      } else if (step.type === 'free_text' && typeof v === 'string' && v.trim()) {
        const ok = gradeRubricLocal(v, step.referenceAnswer);
        gr[i] = { ...FALLBACK_GRADE, is_correct: ok, feedback: ok ? '答對了' : '再想想看' };
        fb[i] = true;
      }
    });
    if (Object.keys(fb).length) setFeedback((prev) => ({ ...fb, ...prev }));
    if (Object.keys(gr).length) setGrades((prev) => ({ ...gr, ...prev }));
  }, [value, steps]);

  // Group consecutive steps sharing a section into one region. The region carries the
  // worked-example passage (context) once; a step's own context is lifted to its group.
  const groups = useMemo(() => {
    const gs: { section: string | null; context: string | null; items: number[] }[] = [];
    steps.forEach((s, i) => {
      const section = s.section ?? null;
      const last = gs[gs.length - 1];
      if (!last || last.section !== section) {
        gs.push({ section, context: s.context ?? null, items: [i] });
      } else {
        if (!last.context && s.context) last.context = s.context;
        last.items.push(i);
      }
    });
    return gs;
  }, [steps]);

  const setStepValue = useCallback(
    (i: number, v: unknown) => onChange({ ...value, [i]: v }),
    [onChange, value],
  );

  // Allow re-answering a step after a wrong verdict: clear its feedback + grade so the
  // options re-enable and the confirm/submit button comes back (keep the current value).
  const retryStep = (i: number) => {
    setFeedback((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
    setGrades((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });
  };

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
        [i]: { ...FALLBACK_GRADE, is_correct: localCorrect, feedback: localCorrect ? '答對了' : '再想想看' },
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
      setGrades((prev) => ({ ...prev, [i]: FALLBACK_GRADE }));
      setFeedback((prev) => ({ ...prev, [i]: true }));
    } finally {
      setGradingStep(null);
    }
  };

  const renderStep = (i: number) => {
    const step = steps[i];
    const fb = feedback[i];
    const submitted = fb === true || fb === false;
    const options = step.options ?? [];
    return (
      <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
        <p className="text-base font-medium text-on-surface leading-relaxed whitespace-pre-wrap">{step.prompt}</p>

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
                    'w-full text-left rounded-lg border px-4 py-2.5 text-base transition-colors flex items-start gap-2',
                    value[i] === oi ? 'border-violet-500 bg-violet-50 text-violet-900' : 'border-gray-200 hover:border-violet-300',
                    submitted ? 'cursor-default' : '',
                  ].join(' ')}
                >
                  <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border border-current text-xs font-bold">
                    {OPTION_LETTERS[oi] ?? oi + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap">{opt}</span>
                </button>
              ))}
            </div>
            {!submitted ? (
              <button
                type="button"
                onClick={() => submitSelect(i)}
                disabled={typeof value[i] !== 'number' || disabled}
                className="px-5 py-2 rounded-full text-base font-medium text-white bg-violet-600 hover:bg-violet-700 active:scale-95 transition-all disabled:opacity-40 disabled:hover:bg-violet-600"
              >
                確認
              </button>
            ) : fb === false ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center gap-3">
                <p className="text-base font-medium text-amber-800">再想想看</p>
                <button
                  type="button"
                  onClick={() => retryStep(i)}
                  className="text-sm font-medium text-violet-700 underline underline-offset-2 cursor-pointer"
                >
                  再試一次
                </button>
              </div>
            ) : (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5">
                <p className="text-base font-medium text-emerald-700">✓ 答對了</p>
              </div>
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
                  <label
                    key={oi}
                    className={[
                      'w-full text-left rounded-lg border px-4 py-2.5 text-base transition-colors flex items-start gap-3',
                      checked ? 'border-violet-500 bg-violet-50 text-violet-900' : 'border-gray-200 hover:border-violet-300',
                      submitted ? 'cursor-default' : 'cursor-pointer',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={submitted}
                      onChange={() => {
                        const next = checked ? picked.filter((x) => x !== oi) : [...picked, oi].sort((a, b) => a - b);
                        setStepValue(i, next);
                      }}
                      className="mt-1 shrink-0"
                    />
                    <span className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full border border-current text-xs font-bold">
                      {OPTION_LETTERS[oi] ?? oi + 1}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap">{opt}</span>
                  </label>
                );
              })}
            </div>
            {!submitted ? (
              <button
                type="button"
                onClick={() => submitMultiSelect(i)}
                disabled={!Array.isArray(value[i]) || (value[i] as number[]).length === 0 || disabled}
                className="px-5 py-2 rounded-full text-base font-medium text-white bg-violet-600 hover:bg-violet-700 active:scale-95 transition-all disabled:opacity-40 disabled:hover:bg-violet-600"
              >
                確認
              </button>
            ) : fb === false ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center gap-3">
                <p className="text-base font-medium text-amber-800">再想想看</p>
                <button
                  type="button"
                  onClick={() => retryStep(i)}
                  className="text-sm font-medium text-violet-700 underline underline-offset-2 cursor-pointer"
                >
                  再試一次
                </button>
              </div>
            ) : (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2.5">
                <p className="text-base font-medium text-emerald-700">✓ 答對了</p>
              </div>
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
                className="px-5 py-2 rounded-full text-base font-medium text-white bg-violet-600 hover:bg-violet-700 active:scale-95 transition-all disabled:opacity-40 disabled:hover:bg-violet-600"
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
                {!grades[i].is_correct ? (
                  <button
                    type="button"
                    onClick={() => retryStep(i)}
                    className="mt-2 block text-sm font-medium text-violet-700 underline underline-offset-2 cursor-pointer"
                  >
                    再試一次
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    );
  };

  // Progress sense (display-only, derived from feedback) — mirrors MultipleChoiceExercise's
  // 「第 X 題／共 N 題」+ thin bar. Counts steps with a correct verdict as done.
  const doneCount = steps.filter((_, i) => feedback[i] === true).length;
  const progressPct = steps.length > 0 ? (doneCount / steps.length) * 100 : 0;

  return (
    <div className="space-y-5">
      <p className="text-base text-on-surface whitespace-pre-wrap">{question.instruction}</p>

      {steps.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm text-on-surface-variant">
            <span>已完成 {doneCount}／共 {steps.length} 題</span>
            <span>{allDone ? '完成！' : '繼續加油！'}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-violet-500 h-1.5 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
      {groups.map((g, gi) => {
        const isExample = !!g.context; // a region with a worked-example passage
        return (
          <div
            key={gi}
            className={[
              'rounded-xl border p-4 space-y-3',
              isExample ? 'border-amber-300 bg-amber-50/40' : 'border-gray-200 bg-gray-50/60',
            ].join(' ')}
          >
            {g.section && (
              <div className="flex items-center gap-2">
                <span
                  className={[
                    'inline-block rounded-full px-3 py-1 text-sm font-bold',
                    isExample ? 'bg-amber-200 text-amber-900' : 'bg-violet-100 text-violet-800',
                  ].join(' ')}
                >
                  {g.section}
                </span>
                <span className="h-px flex-1 bg-gray-200" />
              </div>
            )}
            {g.context && (
              <div className="rounded-xl border border-amber-200 bg-white p-4 text-base leading-relaxed text-gray-800 whitespace-pre-wrap">
                {g.context}
              </div>
            )}
            {g.items.map((i) => renderStep(i))}
          </div>
        );
      })}
    </div>
  );
};

export default GuidedStepsInput;

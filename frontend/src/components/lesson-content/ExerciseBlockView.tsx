/**
 * ExerciseBlockView — the EDD (evidence-driven-development)收口點.
 *
 * It does NOT grade itself: it (a) picks an input widget by `question.kind`, (b) feeds
 * the widget's raw student value to the single authority `grade(exercise, value)` in
 * lessonGrading.ts, (c) reports the verdict up to LessonRenderer.
 *
 * Structural guard against "pretty but ungradable": the widget-picker is EXHAUSTIVE over
 * the 8 kinds; every branch produces a value in the same runtime shape `grade()` expects.
 * The only escape hatch, `custom`, is forced by the schema to needsReview:true → rendered
 * read-only-ish with a 「需人工檢核」 badge, verdict stays null, never auto-passes.
 *
 * rubric_ai (guided_steps / graphic_text_integration) is graded inside GuidedStepsInput
 * (async AI + fail-closed local fallback), which reports overall step completion here.
 *
 * MCQ choice attempts reuse `recordMcqAttempt` telemetry (choice truncated to VARCHAR(8))
 * and, on a wrong answer, offer the existing `McqRescueDialog`.
 *
 * Hooks are declared at top level before the effects that reference them (#2279 TDZ gate).
 */
import React, { useCallback, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { recordMcqAttempt } from '../../services/learningApi';
import type { ExerciseBlockT } from '../../schema/lessonContent';
import { grade } from './lessonGrading';
import ChoiceInput from './inputs/ChoiceInput';
import MultiChoiceInput from './inputs/MultiChoiceInput';
import OrderingInput from './inputs/OrderingInput';
import TraitInput from './inputs/TraitInput';
import GuidedStepsInput, { type GuidedQuestion } from './inputs/GuidedStepsInput';
import KeypointsTableInput, { type KeypointsQuestion } from './inputs/KeypointsTableInput';
import FillInBlankInput, { type FillShape } from './inputs/FillInBlankInput';
import CustomExerciseView from './inputs/CustomExerciseView';
import McqRescueDialog, { type McqRescueContext } from '../reading-spotlight/McqRescueDialog';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export interface ExerciseBlockViewProps {
  exercise: ExerciseBlockT;
  lessonCode: string;
  storyTitle?: string | null;
  passage?: string | null;
  /** Current raw student value for this exercise (owned by LessonRenderer). */
  value: unknown;
  onValueChange: (value: unknown) => void;
  /** Report the machine verdict (or null for manual). */
  onGraded: (result: { verdict: boolean | null; needsReview: boolean }) => void;
  /** Current verdict (true/false submitted, null = manual/needs-review, undefined = unanswered). */
  verdict?: boolean | null;
}

/** Decide which of FillInBlankInput's three shapes an exercise uses. */
function fillShape(exercise: ExerciseBlockT): FillShape {
  if (exercise.question.kind !== 'fill_in_blank') return 'set-list';
  if (exercise.answerSpace === 'choice') return 'vocab-choice';
  if (exercise.question.slots != null && exercise.question.slots.length > 0) return 'slots';
  return 'set-list';
}

const ExerciseBlockView: React.FC<ExerciseBlockViewProps> = ({
  exercise,
  lessonCode,
  storyTitle,
  passage,
  value,
  onValueChange,
  onGraded,
  verdict,
}) => {
  const { token } = useAuth();
  const [rescue, setRescue] = useState<McqRescueContext | null>(null);
  const q = exercise.question;
  const submitted = verdict !== undefined && verdict !== null;

  const submit = useCallback(
    (studentValue: unknown) => {
      const result = grade(exercise, studentValue);
      onGraded(result);
    },
    [exercise, onGraded],
  );

  // ── custom (manual, needs review) — render + record, never auto-pass ──────────
  if (q.kind === 'custom') {
    return (
      <CustomExerciseView
        prompt={q.prompt}
        renderHint={q.renderHint}
        value={String(value ?? '')}
        onChange={(text) => {
          onValueChange(text);
          onGraded({ verdict: null, needsReview: true });
        }}
      />
    );
  }

  // ── rubric_ai guided steps / graphic-text integration ────────────────────────
  if (q.kind === 'guided_steps' || q.kind === 'graphic_text_integration') {
    const stepValue = (value as Record<number, unknown>) ?? {};
    return (
      <GuidedStepsInput
        question={q as GuidedQuestion}
        strategyName={q.strategyName}
        storyTitle={storyTitle}
        passage={passage}
        value={stepValue}
        onChange={(v) => onValueChange(v)}
        onAllStepsDone={(done) => {
          // Reset to null when not all-correct (a wrong step, or 再試一次) so the parent never
          // latches a stale ✓ complete verdict.
          onGraded({ verdict: done ? true : null, needsReview: false });
        }}
      />
    );
  }

  // ── multiple_choice single (choice) ──────────────────────────────────────────
  if (q.kind === 'multiple_choice' && exercise.answerSpace === 'choice') {
    const handlePick = (i: number) => {
      onValueChange(i);
      const result = grade(exercise, i);
      onGraded(result);
      // telemetry (choice letter truncated to VARCHAR(8)) — fire-and-forget.
      if (token) {
        recordMcqAttempt(token, {
          lesson_id: lessonCode,
          question_id: exercise.id,
          choice: (LETTERS[i] ?? String(i)).slice(0, 8),
          is_correct: result.verdict === true,
        });
      }
      // rescue on wrong.
      if (result.verdict === false) {
        const answerIdx = typeof exercise.answer === 'number' ? exercise.answer : 0;
        setRescue({
          questionId: exercise.id,
          lessonId: lessonCode,
          wrongChoice: LETTERS[i] ?? String(i),
          wrongChoiceText: q.options[i],
          questionText: q.question,
          correctAnswer: LETTERS[answerIdx] ?? String(answerIdx),
          correctAnswerText: q.options[answerIdx],
          options: q.options,
          optionLabels: q.options.map((_, oi) => LETTERS[oi] ?? String(oi)),
          strategyType: null,
        });
      }
    };
    return (
      <>
        <p className="text-base font-medium text-on-surface mb-3 whitespace-pre-wrap">{q.question}</p>
        <ChoiceInput
          options={q.options}
          value={typeof value === 'number' ? value : null}
          onChange={handlePick}
          verdict={verdict}
        />
        {submitted ? (
          <p className={`mt-3 text-base font-medium ${verdict ? 'text-green-700' : 'text-amber-700'}`}>
            {verdict ? '✓ 答對了' : '再想想看'}
          </p>
        ) : null}
        <McqRescueDialog
          isOpen={rescue !== null}
          context={rescue}
          onClose={() => setRescue(null)}
        />
      </>
    );
  }

  // ── multiple_choice multi (multi_choice, set) ────────────────────────────────
  if (q.kind === 'multiple_choice' && exercise.answerSpace === 'multi_choice') {
    const arr = Array.isArray(value) ? (value as number[]) : [];
    return (
      <div>
        <p className="text-base font-medium text-on-surface mb-3 whitespace-pre-wrap">{q.question}</p>
        <MultiChoiceInput options={q.options} value={arr} onChange={(v) => onValueChange(v)} verdict={verdict} />
        {!submitted ? (
          <button
            type="button"
            onClick={() => submit(arr)}
            disabled={arr.length === 0}
            className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
          >
            確認
          </button>
        ) : (
          <p className={`mt-3 text-base font-medium ${verdict ? 'text-green-700' : 'text-amber-700'}`}>
            {verdict ? '✓ 答對了' : '再想想看'}
          </p>
        )}
      </div>
    );
  }

  // ── ordering ─────────────────────────────────────────────────────────────────
  if (q.kind === 'ordering') {
    const perm = Array.isArray(value) ? (value as number[]) : q.items.map((_, i) => i);
    return (
      <div>
        <p className="text-base font-medium text-on-surface mb-3 whitespace-pre-wrap">{q.instruction}</p>
        <OrderingInput items={q.items} value={perm} onChange={(v) => onValueChange(v)} verdict={verdict} />
        {!submitted ? (
          <button
            type="button"
            onClick={() => submit(perm)}
            className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600"
          >
            確認排序
          </button>
        ) : (
          <p className={`mt-3 text-base font-medium ${verdict ? 'text-green-700' : 'text-amber-700'}`}>
            {verdict ? '✓ 排序正確' : '再想想看'}
          </p>
        )}
      </div>
    );
  }

  // ── trait_inference ──────────────────────────────────────────────────────────
  if (q.kind === 'trait_inference') {
    return (
      <div>
        <TraitInput
          character={q.character}
          instruction={q.instruction}
          clues={q.clues}
          traitOptions={q.traitOptions}
          value={typeof value === 'number' ? value : null}
          onChange={(i) => onValueChange(i)}
          verdict={verdict}
        />
        {!submitted ? (
          <button
            type="button"
            onClick={() => submit(value)}
            disabled={typeof value !== 'number'}
            className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600 disabled:opacity-40"
          >
            確認
          </button>
        ) : (
          <p className={`mt-3 text-base font-medium ${verdict ? 'text-green-700' : 'text-amber-700'}`}>
            {verdict ? '✓ 答對了' : '再想想看'}
          </p>
        )}
      </div>
    );
  }

  // ── keypoints_table ──────────────────────────────────────────────────────────
  if (q.kind === 'keypoints_table') {
    const dict = (value as Record<string, string>) ?? {};
    return (
      <div>
        <KeypointsTableInput question={q as KeypointsQuestion} value={dict} onChange={(v) => onValueChange(v)} verdict={verdict} />
        {!submitted ? (
          <button
            type="button"
            onClick={() => submit(dict)}
            className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600"
          >
            確認
          </button>
        ) : (
          <p className={`mt-3 text-base font-medium ${verdict ? 'text-green-700' : 'text-amber-700'}`}>
            {verdict ? '✓ 全部答對' : '再檢查看看'}
          </p>
        )}
      </div>
    );
  }

  // ── fill_in_blank (three shapes) ─────────────────────────────────────────────
  if (q.kind === 'fill_in_blank') {
    const shape = fillShape(exercise);
    if (shape === 'vocab-choice') {
      const options = q.vocabBank ? Object.keys(q.vocabBank).sort().map((k) => q.vocabBank![k]) : [];
      const handlePick = (i: number) => {
        onValueChange(i);
        submit(i);
      };
      return (
        <FillInBlankInput
          shape="vocab-choice"
          sentence={q.sentence}
          vocabOptions={options}
          choiceValue={typeof value === 'number' ? value : null}
          onChoiceChange={handlePick}
          verdict={verdict}
        />
      );
    }
    if (shape === 'slots') {
      const dict = (value as Record<string, string>) ?? {};
      return (
        <div>
          <FillInBlankInput
            shape="slots"
            sentence={q.sentence}
            slots={(q.slots ?? []).map((s) => ({ id: s.id, hint: s.hint }))}
            slotValue={dict}
            onSlotChange={(v) => onValueChange(v)}
            verdict={verdict}
          />
          {!submitted ? (
            <button type="button" onClick={() => submit(dict)} className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600">
              確認
            </button>
          ) : (
            <p className={`mt-3 text-base font-medium ${verdict ? 'text-green-700' : 'text-amber-700'}`}>
              {verdict ? '✓ 答對了' : '再想想看'}
            </p>
          )}
        </div>
      );
    }
    // set-list
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        <FillInBlankInput
          shape="set-list"
          sentence={q.sentence}
          listValue={list}
          onListChange={(v) => onValueChange(v)}
          verdict={verdict}
        />
        {!submitted ? (
          <button type="button" onClick={() => submit(list)} className="mt-3 px-4 py-2 rounded-full text-base font-medium text-white bg-violet-600">
            確認
          </button>
        ) : (
          <p className={`mt-3 text-base font-medium ${verdict ? 'text-green-700' : 'text-amber-700'}`}>
            {verdict ? '✓ 答對了' : '再想想看'}
          </p>
        )}
      </div>
    );
  }

  // Exhaustiveness guard — unreachable given the 8-kind union.
  return null;
};

export default ExerciseBlockView;

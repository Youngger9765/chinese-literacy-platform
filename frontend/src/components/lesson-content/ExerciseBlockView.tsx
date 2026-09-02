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
import CorrectAnswerBurst from '../gamification/CorrectAnswerBurst';

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

/** 本體：只負責畫題目。慶祝動畫由外層 wrapper 統一掛，見檔尾。 */
const ExerciseBlockViewBody: React.FC<
  ExerciseBlockViewProps & { onCorrect: () => void }
> = ({
  exercise,
  lessonCode,
  storyTitle,
  passage,
  value,
  onValueChange,
  onGraded,
  verdict,
  onCorrect,
}) => {
  const { token } = useAuth();
  const [rescue, setRescue] = useState<McqRescueContext | null>(null);
  // 答錯時備好的 context —— 備好不等於打開，學生按了才變成 `rescue`。
  const [pendingRescue, setPendingRescue] = useState<McqRescueContext | null>(null);
  const q = exercise.question;
  const submitted = verdict !== undefined && verdict !== null;

  const submit = useCallback(
    (studentValue: unknown) => {
      const result = grade(exercise, studentValue);
      onGraded(result);
      // Issue 3024 —— 慶祝要在這裡觸發，不是在某個題型分支裡。
      // 七種題型（複選／排序／trait_inference／keypoints_table／
      // fill_in_blank 的三種形狀）全部經過這支共用的 submit，
      // 只在單選那個分支呼叫 onCorrect 的話，它們答對什麼都不會發生。
      if (result.verdict === true) {
        onCorrect();
      }
    },
    [exercise, onGraded, onCorrect],
  );

  // Retry a wrong lock-on-submit exercise (parallels guided_steps' 再試一次): clear the
  // selection + reset the verdict to null, which unlocks the input (submitted=false) and does
  // NOT count toward completion (allDone requires === true). Without this a single wrong MCQ
  // on the 閱讀理解 step is a dead-end (can't retry, can't advance).
  const retry = useCallback(() => {
    onValueChange(null);
    onGraded({ verdict: null, needsReview: false });
  }, [onValueChange, onGraded]);

  // Shared submitted-state feedback + 再試一次 (only shown on a wrong verdict) for the
  // machine-graded lock-on-submit kinds.
  const submittedFeedback = (okMsg: string, wrongMsg: string) => (
    <div className="mt-3 flex items-center gap-3">
      <p className={`text-base font-medium ${verdict ? 'text-green-700' : 'text-amber-700'}`}>
        {verdict ? okMsg : wrongMsg}
      </p>
      {verdict === false ? (
        <button
          type="button"
          onClick={retry}
          className="px-4 py-1.5 rounded-full text-base font-medium text-violet-700 border border-violet-300 hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          再試一次
        </button>
      ) : null}
    </div>
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
          // Issue 3024 —— 引導題（重點導讀）全部答對也要慶祝。
          // `verdict !== true` 這個條件是防重複：這個 callback 每次 render 都可能
          // 帶著 done=true 再進來一次，沒有它就會一直重放。
          if (done && verdict !== true) {
            onCorrect();
          }
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
      // Issue 3024 — brief, non-blocking positive reinforcement on a correct
      // pick. Never fires on a wrong answer; carries no score/attempt-count
      // semantics (that's a separate, deliberately out-of-scope ticket about
      // accuracy-based rewards).
      if (result.verdict === true) {
        onCorrect();
      }
      // telemetry (choice letter truncated to VARCHAR(8)) — fire-and-forget.
      if (token) {
        recordMcqAttempt(token, {
          lesson_id: lessonCode,
          question_id: exercise.id,
          choice: (LETTERS[i] ?? String(i)).slice(0, 8),
          is_correct: result.verdict === true,
        });
      }
      // 答錯**不**自動彈出小語老師（Young 2026-08-19）：
      //
      // > 為什麼「小語老師」都在我寫錯的時候自動跳出來啊？
      // > 應該要等我送出後，我自己決定要不要 call 小語老師
      //
      // 只把 context 備好，由學生按按鈕才開。旁邊那條路
      //（`MultipleChoiceExercise`）從 #1507 起就是按鈕才開，這裡沒跟上。
      if (result.verdict === false) {
        const answerIdx = typeof exercise.answer === 'number' ? exercise.answer : 0;
        setPendingRescue({
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
        <p className="text-lg font-medium text-on-surface mb-4 leading-relaxed whitespace-pre-wrap">{q.question}</p>
        <ChoiceInput
          options={q.options}
          value={typeof value === 'number' ? value : null}
          onChange={handlePick}
          verdict={verdict}
        />
        {submitted ? submittedFeedback('✓ 答對了', '再想想看') : null}
        {pendingRescue && rescue === null ? (
          <button
            type="button"
            onClick={() => setRescue(pendingRescue)}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors"
          >
            <span aria-hidden="true">🦉</span>
            問小語老師，一起想想看
          </button>
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
        <p className="text-lg font-medium text-on-surface mb-4 leading-relaxed whitespace-pre-wrap">{q.question}</p>
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
          submittedFeedback('✓ 答對了', '再想想看')
        )}
      </div>
    );
  }

  // ── ordering ─────────────────────────────────────────────────────────────────
  if (q.kind === 'ordering') {
    const perm = Array.isArray(value) ? (value as number[]) : q.items.map((_, i) => i);
    return (
      <div>
        <p className="text-lg font-medium text-on-surface mb-4 leading-relaxed whitespace-pre-wrap">{q.instruction}</p>
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
          submittedFeedback('✓ 排序正確', '再想想看')
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
          submittedFeedback('✓ 答對了', '再想想看')
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
          submittedFeedback('✓ 全部答對', '再檢查看看')
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
        <div>
          <FillInBlankInput
            shape="vocab-choice"
            sentence={q.sentence}
            vocabOptions={options}
            choiceValue={typeof value === 'number' ? value : null}
            onChoiceChange={handlePick}
            verdict={verdict}
          />
          {submitted ? submittedFeedback('✓ 答對了', '再想想看') : null}
        </div>
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
            submittedFeedback('✓ 答對了', '再想想看')
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
          submittedFeedback('✓ 答對了', '再想想看')
        )}
      </div>
    );
  }

  // Exhaustiveness guard — unreachable given the 8-kind union.
  return null;
};

/**
 * Issue 3024 — 慶祝動畫掛在這一層，不掛在本體裡面。
 *
 * 為什麼：本體有 10 個 early return（custom / guided_steps / 複選 / 排序 /
 * trait_inference / keypoints_table / vocab-choice / slots ×2 / 單選），
 * 把 <CorrectAnswerBurst> 寫進其中一個分支，其餘九種題型答對就什麼都不會發生。
 * 第一版就是這樣，preview 上實測「閱讀理解答對 → 沒有任何回饋」。
 * 掛在分支之外只需要一處，而且新增題型不會漏掉。
 *
 * CorrectAnswerBurst 是 position:fixed + pointer-events-none，
 * 掛在哪一層都不影響版面。
 */
const ExerciseBlockView: React.FC<ExerciseBlockViewProps> = (props) => {
  const [correctBurstKey, setCorrectBurstKey] = useState(0);
  return (
    <>
      <CorrectAnswerBurst triggerKey={correctBurstKey} />
      <ExerciseBlockViewBody
        {...props}
        onCorrect={() => setCorrectBurstKey((k) => k + 1)}
      />
    </>
  );
};

export default ExerciseBlockView;

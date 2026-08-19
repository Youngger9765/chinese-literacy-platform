/**
 * WrongAnswerReviewList — shared "錯題解析" card list (issue #2773).
 *
 * Extracted visual pattern shared by the two existing independent implementations
 * (FillInBlankExercise.tsx summary phase, VocabDefinitionMatchSummary.tsx) so the
 * still-missing 閱讀理解 (comprehension) path can reuse it instead of writing a
 * third copy. This component does NOT replace either existing one — both are live
 * and correct; this is net-new for the comprehension wiring (tracked separately,
 * blocked on the LessonRenderer pagination fix in flight — see issue #2773).
 *
 * 🔴 Fail-closed by design: this list only ever reveals a correct answer, so the
 * `revealed` prop is a mandatory, explicit statement from the caller that the
 * student has already submitted/finished. `revealed={false}` (or omitted) renders
 * nothing — never a partial or masked list — so a caller that forgets to gate
 * this behind "phase === summary" cannot accidentally leak an answer mid-attempt.
 */
import React from 'react';

export interface WrongAnswerReviewItem {
  /** Stable identifier — used only as the React key. */
  id: string | number;
  /** The question/sentence text, already resolved to display form. */
  promptText: React.ReactNode;
  correct: boolean;
  correctAnswerText: string;
  /** Student's first wrong pick. Ignored (never rendered) when `correct` is true. */
  studentAnswerText?: string | null;
}

export interface WrongAnswerReviewListProps {
  items: WrongAnswerReviewItem[];
  /** Must be explicitly true — see the fail-closed note above. */
  revealed: boolean;
}

export function WrongAnswerReviewList({ items, revealed }: WrongAnswerReviewListProps) {
  if (!revealed) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="wrong-answer-review-list">
      {items.map((item) => (
        <div
          key={item.id}
          className={`rounded-2xl p-5 ${item.correct ? 'bg-emerald-50' : 'bg-amber-50'}`}
        >
          <div className="flex items-start gap-3">
            <span
              className={`material-symbols-outlined text-xl mt-0.5 ${
                item.correct ? 'text-emerald-600' : 'text-amber-600'
              }`}
            >
              {item.correct ? 'check_circle' : 'cancel'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-base text-on-surface leading-relaxed mb-1">{item.promptText}</p>
              {/* Correct answer is always shown (mirrors VocabDefinitionMatchSummary's
                  "正確答案：" line) — a comprehension MCQ prompt has no bracket to embed
                  the answer into the way a fill-in-blank sentence does, so this line is
                  the only place the answer surfaces for a correct item too. */}
              <p className={`text-sm ${item.correct ? 'text-on-surface-variant' : 'text-amber-700'}`}>
                {!item.correct && item.studentAnswerText ? (
                  <>
                    你選了 <span className="font-bold">{item.studentAnswerText}</span>
                    <span className="text-on-surface-variant mx-1">→</span>
                  </>
                ) : null}
                正確：<span className="font-bold text-emerald-700">{item.correctAnswerText}</span>
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default WrongAnswerReviewList;

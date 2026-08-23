/**
 * QuizCompletionScreen — shared "you're done" wrapper for MCQ-style practice steps
 * (issue #2834, Young 2026-08-21: 「選擇題請統一用 vocab-application 的結束方式」).
 *
 * Before this, the header card (🎓/🏆 icon + 「你完成了！」/「全部答對！」 + subtitle) and
 * the bottom CTA row (重做錯題 / 全部重做 / 下一關, or the toolbox-mode swap) were
 * IDENTICAL markup independently duplicated in `FillInBlankExercise.tsx` (語詞應用) and
 * `VocabDefinitionMatchSummary.tsx` (詞語理解) — same Tailwind classes, same copy, copy-
 * pasted. `ComprehensionMcqPage` (閱讀理解) had neither: no completion card, no retry
 * buttons, just a bare per-question list and a lone "下一步" button.
 *
 * This component is the ONE place that card + CTA row is drawn. `FillInBlankExercise`
 * and `ComprehensionMcqPage` both render through it now — see
 * `quizCompletionScreenUsage.test.ts` for the "nobody hand-rolls a second copy" lock.
 * `VocabDefinitionMatchSummary` is intentionally NOT migrated in this change (out of
 * scope for #2834 — that file's own header/CTA duplicate is pre-existing, not new).
 *
 * Per-question breakdown is deliberately NOT this component's concern — callers pass
 * their own list as `children` (typically `<WrongAnswerReviewList items={...} revealed />`,
 * but FillInBlankExercise keeps its own bracket-fill row shape, which embeds the correct
 * answer INSIDE the sentence text rather than as a separate "正確：" line).
 */
import React from 'react';
import ToolboxCompletionActions, { type ToolboxCompletionActionsProps } from '../tools/ToolboxCompletionActions';
import NextStepFooter from './NextStepFooter';
import StepActionBar from './StepActionBar';

export interface QuizCompletionScreenProps {
  /** Drives the header icon/copy/color. True only when EVERY question was correct on the first try. */
  allCorrect: boolean;
  /** Count of first-try-wrong questions. Gates the 重做錯題 button — hidden at 0. */
  wrongCount: number;
  onRetryWrong: () => void;
  onRetryAll: () => void;
  onNext: () => void;
  /** Button text for the "next" CTA. Defaults to vocab-application's copy. */
  nextLabel?: string;
  /** Overrides the default title. Prefer the default so wording stays unified across steps. */
  title?: string;
  subtitle?: string;
  /** Extra style on the outer wrapper (e.g. FillInBlankExercise's zhuyin font-family, which is inherited by children). */
  style?: React.CSSProperties;
  /** True when reached via 練習工具箱 (`/tools`) — swaps the CTA row for 重做 / 回到練習工具箱. */
  toolboxMode?: boolean;
  toolboxRecordPayload?: ToolboxCompletionActionsProps['recordPayload'];
  /** Per-question breakdown — the caller's own list component. */
  children: React.ReactNode;
}

const QuizCompletionScreen: React.FC<QuizCompletionScreenProps> = ({
  allCorrect,
  wrongCount,
  onRetryWrong,
  onRetryAll,
  onNext,
  nextLabel = '下一關',
  title,
  subtitle,
  style,
  toolboxMode = false,
  toolboxRecordPayload,
  children,
}) => {
  const headline = title ?? (allCorrect ? '全部答對！' : '你完成了！');
  const sub = subtitle ?? (allCorrect ? '每一題都一次答對，表現優異！' : '以下是各題的作答結果');

  return (
    <div className="flex-1 flex flex-col bg-surface overflow-y-auto pb-48" style={style}>
      <div className="max-w-2xl mx-auto px-6 pt-8 w-full space-y-6">
        {/* Score card */}
        <div
          className={`rounded-3xl p-8 text-center ${
            allCorrect ? 'bg-emerald-50' : 'bg-surface-container-lowest shadow-editorial'
          }`}
        >
          <div
            className={`w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center ${
              allCorrect ? 'bg-emerald-100' : 'bg-tertiary-container/20'
            }`}
          >
            <span
              className={`material-symbols-outlined text-4xl ${
                allCorrect ? 'text-emerald-600' : 'text-tertiary'
              }`}
            >
              {allCorrect ? 'emoji_events' : 'school'}
            </span>
          </div>
          <p className="text-2xl font-headline font-black text-on-surface mb-1">{headline}</p>
          <p className="text-sm text-on-surface-variant">{sub}</p>
        </div>

        {children}
      </div>

      {/* Fixed bottom CTA */}
      <StepActionBar layout="stack">
          {toolboxMode ? (
            <ToolboxCompletionActions onRetry={onRetryAll} className="w-full" recordPayload={toolboxRecordPayload} />
          ) : (
            <>
              {wrongCount > 0 && (
                <button
                  type="button"
                  onClick={onRetryWrong}
                  className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all"
                >
                  重做錯題（{wrongCount} 題）
                </button>
              )}
              <button
                type="button"
                onClick={onRetryAll}
                className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface-variant bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] transition-all"
              >
                全部重做
              </button>
              <NextStepFooter onNext={onNext} label={nextLabel} />
            </>
          )}
      </StepActionBar>
    </div>
  );
};

export default QuizCompletionScreen;

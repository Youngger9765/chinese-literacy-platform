/**
 * SummaryScreen — Score + per-question results for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx. Stateless UI component.
 *
 * #2773: classification switched from `correct` (the LATEST attempt —
 * overwritten every time a student retries a wrong pick) to `firstTryCorrect`
 * (write-once, set on the item's first answer and never touched again). Under
 * the old `correct`-based logic, this screen could NEVER show a wrong item or
 * the 重做錯題 button — a student always retries until right, so `correct` is
 * always eventually true for everything, meaning "全部答對！" was shown
 * unconditionally regardless of how many first-try mistakes were made.
 * Verified live on staging before this fix: 2 deliberate first-try misses out
 * of 11 questions still rendered "答對 11 / 11 題" with zero ✗ cards.
 *
 * Per-item wording now goes through the shared `WrongAnswerReviewList`
 * (also #2773) so it matches vocab-application's FillInBlankExercise summary
 * ("你選了 X → 正確：Y") instead of this screen's previous, differently-worded
 * "正確答案：X | 你的答案：Y" layout.
 */
import React from 'react';
import { VocabItem } from '../../types';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import { WrongAnswerReviewList, type WrongAnswerReviewItem } from '../learning/WrongAnswerReviewList';
import {
  getDragDropAttemptFeedback,
  AnswerRecord,
  InteractionMode,
} from './vocabDefinitionMatchLogic';

export interface SummaryScreenProps {
  inToolbox: boolean;
  vocab: VocabItem[];
  mcAnswers: AnswerRecord[];
  dragDropAnswers: AnswerRecord[];
  onRetryModeWrong: (mode: InteractionMode) => void;
  onRetryAll: () => void;
  onFinish: () => void;
}

/** firstTryCorrect is the authority; fall back to `correct` for records that
 * predate the field (persisted progress saved before this fix landed). */
function firstTryOf(a: AnswerRecord): boolean {
  return (a.firstTryCorrect ?? a.correct) === true;
}

export function SummaryScreen({
  inToolbox,
  vocab,
  mcAnswers,
  dragDropAnswers,
  onRetryModeWrong,
  onRetryAll,
  onFinish,
}: SummaryScreenProps) {
  const mcCorrect = mcAnswers.filter(firstTryOf).length;
  const mcTotal = mcAnswers.length;
  const dragDropCorrect = dragDropAnswers.filter(firstTryOf).length;
  const dragDropTotal = dragDropAnswers.length;
  const correctCount = mcCorrect + dragDropCorrect;
  const total = mcTotal + dragDropTotal;
  const allCorrect = total > 0 && correctCount === total;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  void pct; // used by parent for scoring, kept for clarity
  const mcWrongAnswers = mcAnswers.filter((a) => !firstTryOf(a));
  const dragDropWrongAnswers = dragDropAnswers.filter((a) => !firstTryOf(a));

  const renderResultSection = (title: string, answers: AnswerRecord[], mode: InteractionMode) => {
    const items: WrongAnswerReviewItem[] = answers.map((ans) => {
      const item = vocab[ans.defIndex];
      const isFirstTryCorrect = firstTryOf(ans);
      const studentWord =
        !isFirstTryCorrect && ans.answeredWordIdx !== null ? vocab[ans.answeredWordIdx]?.word ?? null : null;
      const wrongAttempts = ans.wrongAttempts ?? 0;
      const extraNote = mode === 'drag-drop' ? getDragDropAttemptFeedback(wrongAttempts) : null;
      return {
        id: ans.defIndex,
        promptText: item?.definition,
        correct: isFirstTryCorrect,
        correctAnswerText: item?.word ?? '',
        studentAnswerText: studentWord,
        extraNote: extraNote ?? undefined,
      };
    });

    return (
      <div className="flex flex-col gap-3 mb-6">
        <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
          {title}
        </h4>
        <WrongAnswerReviewList items={items} revealed />
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-48 animate-fade-in">
      {/* Score card */}
      <div className={`rounded-3xl p-8 mb-8 text-center ${allCorrect ? 'bg-emerald-50' : 'bg-surface-container-lowest shadow-editorial'}`}>
        <div className={`w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center ${allCorrect ? 'bg-emerald-100' : 'bg-tertiary-container/20'}`}>
          <span className={`material-symbols-outlined text-4xl ${allCorrect ? 'text-emerald-600' : 'text-tertiary'}`}>
            {allCorrect ? 'emoji_events' : 'school'}
          </span>
        </div>
        <p className="text-2xl font-headline font-black text-on-surface mb-1">
          {allCorrect ? '全部答對！' : '你完成了！'}
        </p>
        <p className="text-sm text-on-surface-variant">
          {allCorrect ? '太厲害了，繼續保持！' : '有答對一些，再試一次會更好'}
        </p>
      </div>

      {renderResultSection('第一關：選擇題', mcAnswers, 'multiple-choice')}
      {renderResultSection('第二關：拖拉配對', dragDropAnswers, 'drag-drop')}

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-16 left-0 w-full px-6 pb-8 pt-6 pointer-events-none z-20"
           style={{ background: 'linear-gradient(to top, #FBF6EE 60%, transparent)' }}>
        <div className="max-w-md mx-auto pointer-events-auto flex flex-col gap-2">
          {inToolbox ? (
            <ToolboxCompletionActions onRetry={onRetryAll} className="w-full" />
          ) : (
            <>
              {(mcWrongAnswers.length > 0 || dragDropWrongAnswers.length > 0) && (
                <button
                  onClick={() => mcWrongAnswers.length > 0 ? onRetryModeWrong('multiple-choice') : onRetryModeWrong('drag-drop')}
                  className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface bg-surface-container-lowest shadow-editorial hover:bg-surface-container-low active:scale-[0.98] transition-all">
                  重做錯題
                </button>
              )}
              <button onClick={onRetryAll}
                className="w-full h-12 rounded-full font-headline font-bold text-base text-on-surface-variant bg-surface-container-high hover:bg-surface-container-highest active:scale-[0.98] transition-all">
                全部重做
              </button>
              <button onClick={onFinish}
                className="w-full h-14 rounded-full font-headline font-bold text-xl text-white shadow-[0_12px_48px_rgba(86,74,191,0.3)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #564ABF, #9D93FF)' }}>
                繼續下一步
                <span className="material-symbols-outlined text-xl">arrow_forward</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

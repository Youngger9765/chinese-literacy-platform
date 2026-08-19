/**
 * SummaryScreen — Score + per-question results for VocabDefinitionMatch (#1846)
 *
 * Extracted from VocabDefinitionMatch.tsx. Stateless UI component.
 */
import React from 'react';
import { VocabItem } from '../../types';
import ToolboxCompletionActions from '../tools/ToolboxCompletionActions';
import NextStepFooter from '../learning/NextStepFooter';
import {
  getDragDropAttemptFeedback,
  getDragDropAttemptTone,
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

export function SummaryScreen({
  inToolbox,
  vocab,
  mcAnswers,
  dragDropAnswers,
  onRetryModeWrong,
  onRetryAll,
  onFinish,
}: SummaryScreenProps) {
  const mcCorrect = mcAnswers.filter((a) => a.correct).length;
  const mcTotal = mcAnswers.length;
  const dragDropCorrect = dragDropAnswers.filter((a) => a.correct).length;
  const dragDropTotal = dragDropAnswers.length;
  const correctCount = mcCorrect + dragDropCorrect;
  const total = mcTotal + dragDropTotal;
  const allCorrect = correctCount === total;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  void pct; // used by parent for scoring, kept for clarity
  const mcWrongAnswers = mcAnswers.filter((a) => !a.correct);
  const dragDropWrongAnswers = dragDropAnswers.filter((a) => !a.correct);

  const renderResultSection = (title: string, answers: AnswerRecord[], mode: InteractionMode) => (
    <div className="flex flex-col gap-3 mb-6">
      <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
        {title}
      </h4>
      {answers.map((ans, idx) => {
        const item = vocab[ans.defIndex];
        const isCorrect = ans.correct;
        const studentWord =
          ans.answeredWordIdx !== null ? vocab[ans.answeredWordIdx]?.word : '—';
        const wrongAttempts = ans.wrongAttempts ?? 0;
        const feedback = mode === 'drag-drop'
          ? getDragDropAttemptFeedback(wrongAttempts)
          : null;
        const dragDropTone = getDragDropAttemptTone(wrongAttempts);
        const cardClass = mode === 'drag-drop'
          ? dragDropTone.cardClass
          : (isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200');
        const badgeClass = mode === 'drag-drop'
          ? dragDropTone.badgeClass
          : (isCorrect ? 'bg-emerald-500' : 'bg-red-500');

        return (
          <div
            key={`${title}-${idx}`}
            className={`rounded-xl border-2 px-4 py-3 flex items-start gap-3 ${cardClass}`}
          >
            <span
              className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold text-white ${badgeClass}`}
            >
              {isCorrect ? '✓' : '✗'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500 leading-snug mb-1">
                {item?.definition}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-gray-500">正確答案：</span>
                <span className="font-bold text-gray-800">{item?.word}</span>
                {!isCorrect && (
                  <>
                    <span className="text-gray-400">|</span>
                    <span className="text-gray-500">你的答案：</span>
                    <span className="font-bold text-red-600">{studentWord}</span>
                  </>
                )}
              </div>
              {feedback && (
                <p className="mt-1 text-xs font-semibold text-amber-700">{feedback}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

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
              <NextStepFooter onNext={onFinish} label="繼續下一步" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

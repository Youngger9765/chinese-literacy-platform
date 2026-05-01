/**
 * MultipleChoiceExercise — ⑦ 閱讀理解選擇題 (#615)
 *
 * Displays MCQ questions from the PDF-extracted YAML data.
 * Shows one question at a time; reveals correct answer + explanation after selection.
 *
 * Fix #1330: Show inline completion summary before calling onComplete to prevent
 * layout shift caused by the parent swapping the entire panel DOM.
 */
import React, { useEffect, useRef, useState } from 'react';
import { MultipleChoiceItem } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';

interface Props {
  questions: MultipleChoiceItem[];
  onComplete: (score: number, total: number) => void;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

const MultipleChoiceExercise: React.FC<Props> = ({ questions, onComplete }) => {
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  // Fix #1330: show inline done summary so the parent panel doesn't DOM-swap abruptly
  const [showDone, setShowDone] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const doneRef = useRef<HTMLDivElement>(null);

  const q = questions[current];
  const isLast = current === questions.length - 1;

  // Scroll done card into view smoothly without resetting parent scroll (#1330)
  useEffect(() => {
    if (showDone) {
      doneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showDone]);

  function handleSelect(label: string) {
    if (revealed) return;
    setSelected(label);
    setRevealed(true);
    if (label === q.answer) setScore((s) => s + 1);
  }

  function handleNext() {
    if (isLast) {
      // Fix #1330: show inline summary first; parent onComplete called via "確認完成" button
      const nextScore = selected === q.answer ? score + 1 : score;
      setFinalScore(nextScore);
      setShowDone(true);
      return;
    }
    setCurrent((c) => c + 1);
    setSelected(null);
    setRevealed(false);
  }

  function handleConfirmDone() {
    onComplete(finalScore, questions.length);
  }

  // Inline completion summary — keeps layout stable (#1330)
  if (showDone) {
    const allCorrect = finalScore === questions.length;
    return (
      <div
        ref={doneRef}
        className="flex flex-col items-center justify-center py-10 gap-5 px-4"
        style={{ fontFamily: zhuyinActive ? "'BpmfZihiSans', 'Noto Sans TC', sans-serif" : undefined }}
      >
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-emerald-700 font-bold text-lg">
            {allCorrect ? '全部答對，太棒了！' : '測驗完成，繼續加油！'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            共 {questions.length} 題，答對 {finalScore} 題
          </p>
        </div>
        {/* Progress bar showing final score */}
        <div className="w-full max-w-xs">
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all duration-700"
              style={{ width: `${(finalScore / questions.length) * 100}%` }}
            />
          </div>
        </div>
        <button
          onClick={handleConfirmDone}
          className="rounded-lg bg-blue-500 px-8 py-2.5 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          確認完成
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto"
      style={{ fontFamily: zhuyinActive ? "'BpmfZihiSans', 'Noto Sans TC', sans-serif" : undefined }}>
      {/* Progress — Issue #1094: 學生端不顯示「答對 N 題」數字 */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>第 {current + 1} 題／共 {questions.length} 題</span>
        <span>繼續加油！</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all"
          style={{ width: `${((current + (revealed ? 1 : 0)) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <p className="text-base font-medium text-gray-800 leading-relaxed mb-4">
          {current + 1}. {zh(q.question)}
        </p>

        {/* Options */}
        <div className="flex flex-col gap-2">
          {q.options.map((opt, idx) => {
            const label = OPTION_LABELS[idx];
            const isChosen = selected === label;
            const isAnswerLabel = q.answer === label;

            let btnClass =
              'flex items-start gap-3 rounded-lg border p-3 text-sm text-left transition-all ';
            if (!revealed) {
              btnClass += 'border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer';
            } else if (isAnswerLabel) {
              btnClass += 'border-green-500 bg-green-50 font-semibold text-green-800';
            } else if (isChosen && !isAnswerLabel) {
              btnClass += 'border-tertiary-container bg-tertiary-container/20 text-tertiary line-through';
            } else {
              btnClass += 'border-gray-200 text-gray-400';
            }

            return (
              <button
                key={label}
                onClick={() => handleSelect(label)}
                disabled={revealed}
                className={btnClass}
              >
                <span className="shrink-0 w-6 h-6 rounded-full border border-current flex items-center justify-center text-xs font-bold">
                  {label}
                </span>
                <span>{zh(opt)}</span>
                {revealed && isAnswerLabel && (
                  <span className="ml-auto text-green-600 text-lg">✓</span>
                )}
                {revealed && isChosen && !isAnswerLabel && (
                  <span className="ml-auto text-tertiary text-lg">✗</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Explanation */}
        {revealed && q.explanation && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
            💡 {zh(q.explanation)}
          </div>
        )}
      </div>

      {/* Next / Submit */}
      {revealed && (
        <button
          onClick={handleNext}
          className="self-end rounded-lg bg-blue-500 px-6 py-2 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
        >
          {isLast ? '完成測驗' : '下一題 →'}
        </button>
      )}
    </div>
  );
};

export default MultipleChoiceExercise;

/**
 * MultipleChoiceExercise — ⑦ 閱讀理解選擇題 (#615)
 *
 * Displays MCQ questions from the PDF-extracted YAML data.
 * Shows one question at a time; reveals correct answer + explanation after selection.
 *
 * Issue #1387: McqRescueDialog (AI rescue tutor) reachable via button.
 * Issue #1507: Wrong answer no longer auto-opens the dialog — instead a
 *   「問 AI 助教」button appears so the student opts in. Every click is
 *   logged to mcq_attempt for teacher visibility on students who skip
 *   the rescue.
 */
import React, { useState } from 'react';
import { MultipleChoiceItem } from '../../types';
import { useZhuyin } from '../../context/ZhuyinContext';
import { fontForZhuyin } from '../../constants/fonts';
import { useAuth } from '../../contexts/AuthContext';
import { recordMcqAttempt } from '../../services/learningApi';
import McqRescueDialog, { McqRescueContext } from '../reading-spotlight/McqRescueDialog';

interface Props {
  questions: MultipleChoiceItem[];
  onComplete: (score: number, total: number) => void;
  /** Lesson/story ID — passed through to rescue agent for session keying. */
  lessonId?: string;
  /** Reading strategy type (e.g. 'summary_psr') — selects strategy-specific rescue prompt. */
  readingStrategy?: string | null;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

const MultipleChoiceExercise: React.FC<Props> = ({
  questions,
  onComplete,
  lessonId = '',
  readingStrategy,
}) => {
  const { zhuyinActive, processZhuyin } = useZhuyin();
  const { token } = useAuth();
  const zh = (text: string) => zhuyinActive ? processZhuyin(text) : text;
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);

  // MCQ Rescue dialog state (Issue #1387 / #1507)
  const [rescueOpen, setRescueOpen] = useState(false);
  const [rescueContext, setRescueContext] = useState<McqRescueContext | null>(null);

  const q = questions[current];
  const isCorrect = selected === q.answer;
  const isLast = current === questions.length - 1;
  const questionId = `${lessonId}-q${current}`;

  function handleSelect(label: string) {
    if (revealed) return;
    setSelected(label);
    setRevealed(true);
    const correct = label === q.answer;
    if (correct) {
      setScore((s) => s + 1);
    }

    // Telemetry — every click, including wrong answers where the student
    // never opens the rescue dialog (Issue #1507 / Young 5/8 meeting).
    if (token) {
      recordMcqAttempt(token, {
        lesson_id: lessonId,
        question_id: questionId,
        choice: label,
        is_correct: correct,
        rescue_offered: !correct,
      });
    }
  }

  function openRescue() {
    if (!selected) return;
    const wrongIdx = OPTION_LABELS.indexOf(selected);
    const correctIdx = q.answer ? OPTION_LABELS.indexOf(q.answer) : -1;
    setRescueContext({
      questionId,
      lessonId,
      wrongChoice: selected,
      wrongChoiceText: wrongIdx >= 0 ? q.options[wrongIdx] : undefined,
      questionText: q.question,
      correctAnswer: q.answer ?? '',
      correctAnswerText: correctIdx >= 0 ? q.options[correctIdx] : undefined,
      options: q.options,
      optionLabels: OPTION_LABELS.slice(0, q.options.length),
      strategyType: readingStrategy ?? null,
    });
    setRescueOpen(true);
  }

  function handleNext() {
    if (isLast) {
      onComplete(score, questions.length);
      return;
    }
    setCurrent((c) => c + 1);
    setSelected(null);
    setRevealed(false);
  }

  return (
    <>
    {/* MCQ Rescue dialog — parallel feature, doesn't disrupt existing socratic chat (#1373) */}
    <McqRescueDialog
      isOpen={rescueOpen}
      context={rescueContext}
      onClose={() => setRescueOpen(false)}
      onComplete={() => setRescueOpen(false)}
    />
    <div className="flex flex-col gap-4 p-4 max-w-2xl mx-auto"
      style={{ fontFamily: fontForZhuyin(zhuyinActive) }}>
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

        {/* 問 AI 助教 — only on wrong answers, opt-in (Issue #1507) */}
        {revealed && !isCorrect && !rescueOpen && (
          <button
            onClick={openRescue}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800 hover:bg-amber-100 hover:border-amber-400 transition-colors"
          >
            <span aria-hidden="true">🦉</span>
            問 AI 助教，一起想想看
          </button>
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
    </>
  );
};

export default MultipleChoiceExercise;

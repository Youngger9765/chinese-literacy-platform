/**
 * PickGame.tsx
 *
 * 聲母配對 / 韻母配對 game screen for ZhuyinPhoneticGame.
 * Student picks the correct initial (聲母) or final (韻母) from 4 choices.
 *
 * Extracted from ZhuyinPhoneticGame.tsx as part of refactor/issue-1885.
 * Logic delegated to zhuyinGameEngine (deriveInitialAnswer, deriveFinalAnswer,
 * buildPickChoices) instead of being inlined.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CharZhuyin,
  GameMode,
  AnswerState,
  deriveInitialAnswer,
  deriveFinalAnswer,
  buildPickChoices,
} from './zhuyinGameEngine';

export interface PickGameProps {
  mode: 'initial' | 'final';
  questions: CharZhuyin[];
  onFinish: (score: number, total: number) => void;
  onBack: () => void;
}

export function PickGame({ mode, questions, onFinish, onBack }: PickGameProps) {
  const [qIdx, setQIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [answerState, setAnswerState] = useState<AnswerState>('idle');
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = questions[qIdx];

  // Build correct answer for the current mode using engine helpers
  const correctAnswer = useMemo(() => {
    if (mode === 'initial') return deriveInitialAnswer(q);
    return deriveFinalAnswer(q);
  }, [q, mode]);

  // Build choices via engine — correct answer included, no duplicates
  const choices = useMemo(
    () => buildPickChoices(correctAnswer, mode as GameMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qIdx, mode],
  );

  const handleChoice = useCallback((choice: string) => {
    if (answerState !== 'idle') return;
    setSelectedChoice(choice);
    const isCorrect = choice === correctAnswer;
    setAnswerState(isCorrect ? 'correct' : 'wrong');
    if (isCorrect) setScore(s => s + 1);

    timerRef.current = setTimeout(() => {
      if (qIdx + 1 >= questions.length) {
        onFinish(isCorrect ? score + 1 : score, questions.length);
      } else {
        setQIdx(i => i + 1);
        setAnswerState('idle');
        setSelectedChoice(null);
      }
    }, 900);
  }, [answerState, correctAnswer, qIdx, questions.length, score, onFinish]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const modeLabel = mode === 'initial' ? '聲母' : '韻母';
  const progress = `${qIdx + 1} / ${questions.length}`;

  return (
    <div className="flex-1 flex flex-col bg-indigo-50">
      {/* Header */}
      <div className="h-9 bg-white border-b border-gray-200 flex items-center px-4 gap-2 shrink-0">
        <button
          onClick={onBack}
          aria-label="返回生字練習"
          className="text-gray-400 hover:text-gray-700 transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-gray-700 font-semibold flex-1">選{modeLabel}練習</span>
        <span className="text-xs text-gray-400" aria-label={`第 ${qIdx + 1} 題，共 ${questions.length} 題`}>{progress}</span>
      </div>

      {/* Progress bar */}
      <div
        role="progressbar"
        aria-valuenow={qIdx + 1}
        aria-valuemin={1}
        aria-valuemax={questions.length}
        aria-label={`練習進度：第 ${qIdx + 1} 題，共 ${questions.length} 題`}
        className="w-full h-1.5 bg-gray-200"
      >
        <div
          className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${((qIdx) / questions.length) * 100}%` }}
        />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">

        {/* Question prompt */}
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-500 font-medium">
            這個字的<span className="text-indigo-600 font-bold">{modeLabel}</span>是哪個？
          </p>
          {/* Character display */}
          <div className="w-32 h-32 mx-auto bg-white rounded-3xl shadow-md border border-indigo-100 flex flex-col items-center justify-center gap-1">
            <span className="text-6xl font-bold text-gray-900 leading-none">{q.char}</span>
            <span className="text-xs text-gray-400 mt-1">{q.zhuyin}</span>
          </div>
        </div>

        {/* Feedback flash */}
        {answerState !== 'idle' && (
          <div className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold animate-slide-up-fast ${
            answerState === 'correct'
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-red-100 text-red-700 border border-red-200'
          }`}>
            {answerState === 'correct' ? '答對了！真棒！' : `正確答案是「${correctAnswer}」`}
          </div>
        )}

        {/* Choice buttons */}
        <div className="grid grid-cols-2 gap-4 w-full max-w-xs">
          {choices.map(choice => {
            const isSelected = selectedChoice === choice;
            const isCorrectChoice = choice === correctAnswer;
            let btnClass = 'flex items-center justify-center h-16 rounded-2xl text-2xl font-bold border-2 transition-all active:scale-95 ';
            if (answerState === 'idle') {
              btnClass += 'bg-white border-indigo-200 text-gray-800 hover:bg-indigo-50 hover:border-indigo-400';
            } else if (isCorrectChoice) {
              btnClass += 'bg-emerald-100 border-emerald-500 text-emerald-800';
            } else if (isSelected) {
              btnClass += 'bg-red-100 border-red-400 text-red-700';
            } else {
              btnClass += 'bg-white border-gray-200 text-gray-400';
            }
            return (
              <button
                key={choice}
                onClick={() => handleChoice(choice)}
                disabled={answerState !== 'idle'}
                aria-label={`選擇 ${choice}${answerState !== 'idle' && isCorrectChoice ? '（正確答案）' : answerState !== 'idle' && isSelected && !isCorrectChoice ? '（答錯）' : ''}`}
                aria-pressed={isSelected ? true : undefined}
                className={btnClass}
              >
                {choice}
              </button>
            );
          })}
        </div>

        {/* Encouragement — Issue #1094: 學生端不顯示得分數字 */}
        <p className="text-xs text-gray-400">繼續加油！</p>
      </div>
    </div>
  );
}

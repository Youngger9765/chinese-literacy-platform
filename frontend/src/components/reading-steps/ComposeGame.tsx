/**
 * ComposeGame.tsx
 *
 * 拼音合成 game screen for ZhuyinPhoneticGame.
 * Student taps bopomofo symbols in order to spell a character's pronunciation.
 *
 * Extracted from ZhuyinPhoneticGame.tsx as part of refactor/issue-1885.
 * Palette construction delegated to buildComposePalette (engine),
 * scoring delegated to scoreOnce (engine).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CharZhuyin,
  AnswerState,
  buildComposePalette,
  scoreOnce,
} from './zhuyinGameEngine';
import { composeTargetSeq } from './zhuyinGameLogic';

export interface ComposeGameProps {
  questions: CharZhuyin[];
  onFinish: (score: number, total: number) => void;
  onBack: () => void;
}

export function ComposeGame({ questions, onFinish, onBack }: ComposeGameProps) {
  const [qIdx, setQIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [tapped, setTapped] = useState<string[]>([]);
  const [answerState, setAnswerState] = useState<AnswerState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = questions[qIdx];

  // Target sequence: [initial, medial, finalPart, tone] — non-empty parts
  const targetSeq = useMemo(() => composeTargetSeq(q), [q]);

  // Build symbol palette via engine helper
  const palette = useMemo(() => buildComposePalette(targetSeq), [targetSeq]);

  const handleTap = useCallback((sym: string) => {
    if (answerState !== 'idle') return;
    const next = [...tapped, sym];
    setTapped(next);

    // Check if length matches target
    if (next.length === targetSeq.length) {
      const isCorrect = next.join('') === targetSeq.join('');
      setAnswerState(isCorrect ? 'correct' : 'wrong');
      const newScore = scoreOnce(score, isCorrect);
      if (isCorrect) setScore(newScore);

      timerRef.current = setTimeout(() => {
        if (qIdx + 1 >= questions.length) {
          onFinish(newScore, questions.length);
        } else {
          setQIdx(i => i + 1);
          setTapped([]);
          setAnswerState('idle');
        }
      }, 1000);
    }
  }, [answerState, tapped, targetSeq, score, qIdx, questions.length, onFinish]);

  const handleClear = useCallback(() => {
    if (answerState !== 'idle') return;
    setTapped([]);
  }, [answerState]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

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
        <span className="text-xs text-gray-700 font-semibold flex-1">拼音合成練習</span>
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
          style={{ width: `${(qIdx / questions.length) * 100}%` }}
        />
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">

        {/* Prompt */}
        <div className="text-center space-y-3">
          <p className="text-sm text-gray-500">
            按順序拼出這個字的注音
          </p>
          <div className="w-28 h-28 mx-auto bg-white rounded-3xl shadow-md border border-indigo-100 flex items-center justify-center">
            <span className="text-5xl font-bold text-gray-900">{q.char}</span>
          </div>
        </div>

        {/* Answer slots */}
        <div className="flex items-center gap-2">
          {targetSeq.map((part, i) => {
            const filled = tapped[i];
            const stateClass = answerState === 'idle'
              ? filled
                ? 'bg-indigo-100 border-indigo-400 text-indigo-700'
                : 'bg-white border-dashed border-indigo-300 text-transparent'
              : answerState === 'correct'
                ? 'bg-emerald-100 border-emerald-400 text-emerald-700'
                : 'bg-red-100 border-red-400 text-red-700';
            return (
              <div
                key={i}
                className={`w-12 h-12 flex items-center justify-center rounded-xl border-2 text-xl font-bold transition-all duration-200 ${stateClass}`}
              >
                {filled || '?'}
              </div>
            );
          })}
        </div>

        {/* Feedback */}
        {answerState !== 'idle' && (
          <div className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold animate-slide-up-fast ${
            answerState === 'correct'
              ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
              : 'bg-red-100 text-red-700 border border-red-200'
          }`}>
            {answerState === 'correct'
              ? '拼對了！'
              : `正確是「${targetSeq.join('')}」`}
          </div>
        )}

        {/* Symbol palette */}
        <div className="flex flex-wrap justify-center gap-2 max-w-xs">
          {palette.map((sym, i) => (
            <button
              key={`${sym}-${i}`}
              onClick={() => handleTap(sym)}
              disabled={answerState !== 'idle' || tapped.includes(sym)}
              className={`w-11 h-11 rounded-xl border-2 text-lg font-bold transition-all active:scale-90 ${
                tapped.includes(sym)
                  ? 'bg-indigo-200 border-indigo-300 text-indigo-400 opacity-50'
                  : 'bg-white border-indigo-200 text-gray-800 hover:bg-indigo-50 hover:border-indigo-400'
              }`}
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Clear + score row */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleClear}
            disabled={answerState !== 'idle' || tapped.length === 0}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-800 hover:bg-gray-100 disabled:opacity-40 transition-all"
          >
            清除重拼
          </button>
          <span className="text-xs text-gray-400">加油！</span>
        </div>
      </div>
    </div>
  );
}

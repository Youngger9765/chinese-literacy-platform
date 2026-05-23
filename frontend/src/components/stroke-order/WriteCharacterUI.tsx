/**
 * WriteCharacterUI — issue #1935
 *
 * Pure presentational sub-components extracted from WriteCharacter.tsx:
 *   - ConfettiParticles
 *   - ProgressDots
 *   - StepGuidance
 *   - Toast
 *   - ZhuyinDisplay (stub — WriteCharacter itself has no zhuyin rendering;
 *     the actual zhuyin overlay is handled by the parent VocabPractice layer)
 *
 * None of these components own state or refs.  They are driven entirely
 * by props passed down from WriteCharacter (the orchestrator).
 */

import React from 'react';
import { Step } from './useWriteCharacterMachine';

/* ================================================================ */
/*  ConfettiParticles                                                */
/* ================================================================ */

export function ConfettiParticles() {
  const pieces = [
    { color: 'bg-yellow-400', anim: 'animate-confetti-drop-1', left: '20%', shape: 'rounded-sm w-3 h-3' },
    { color: 'bg-pink-400',   anim: 'animate-confetti-drop-2', left: '50%', shape: 'rounded-full w-2.5 h-2.5' },
    { color: 'bg-sky-400',    anim: 'animate-confetti-drop-3', left: '75%', shape: 'rounded-sm w-2 h-3' },
    { color: 'bg-emerald-400',anim: 'animate-confetti-drop-1', left: '35%', shape: 'rounded-full w-2 h-2' },
    { color: 'bg-violet-400', anim: 'animate-confetti-drop-2', left: '65%', shape: 'rounded-sm w-3 h-2' },
    { color: 'bg-orange-400', anim: 'animate-confetti-drop-3', left: '85%', shape: 'rounded-full w-2.5 h-2.5' },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
      {pieces.map((p, i) => (
        <div
          key={i}
          className={`absolute top-4 ${p.color} ${p.anim} ${p.shape} opacity-0`}
          style={{ left: p.left }}
        />
      ))}
    </div>
  );
}

/* ================================================================ */
/*  ProgressDots                                                     */
/* ================================================================ */

export interface ProgressDotsProps {
  step: Step;
  practiceLeft: number;
}

export function ProgressDots({ step, practiceLeft }: ProgressDotsProps) {
  if (step === Step.ANIMATION || step === Step.COMPLETE) return null;

  const dots = [
    { label: '1', filled: practiceLeft < 4, isNoOutline: false },
    { label: '2', filled: practiceLeft < 3, isNoOutline: false },
    { label: '3', filled: practiceLeft < 2, isNoOutline: false },
    { label: '無框', filled: practiceLeft < 1, isNoOutline: true },
  ];

  return (
    <div className="flex items-center gap-2">
      {dots.map((dot, i) => (
        <React.Fragment key={i}>
          {i === 3 && (
            <div className="w-4 h-px bg-surface-container-highest" />
          )}
          <div className="flex flex-col items-center gap-0.5">
            <div
              className={`flex items-center justify-center rounded-full border-2 transition-all duration-300 ${
                dot.isNoOutline ? 'w-7 h-7' : 'w-6 h-6'
              } ${
                dot.filled
                  ? dot.isNoOutline
                    ? 'border-accent bg-accent'
                    : 'border-emerald-500 bg-emerald-500'
                  : 'border-surface-container-highest bg-transparent'
              }`}
            >
              {dot.filled && (
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className={`text-[9px] ${dot.filled ? 'text-emerald-600' : 'text-on-surface-variant'}`}>
              {dot.label}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ================================================================ */
/*  StepGuidance                                                     */
/* ================================================================ */

export interface StepGuidanceProps {
  step: Step;
  mode: string;
  nStrokes: number;
  completedStrokes: number;
}

export function StepGuidance({ step, mode, nStrokes, completedStrokes }: StepGuidanceProps) {
  if (step === Step.COMPLETE) return null;

  let icon = '';
  let text = '';
  let subtext = '';
  let colorClass = 'text-on-surface-variant bg-surface-container-low';

  if (step === Step.ANIMATION) {
    icon = '👀';
    text = '觀看筆順動畫';
    subtext = '準備好了就按「開始練習」';
    colorClass = 'text-accent bg-accent/10';
  } else if (mode === 'quizzing') {
    const remaining = nStrokes - completedStrokes;
    const isNoOutline = step === Step.PRACTICE_NO_OUTLINE;
    icon = isNoOutline ? '🧠' : '✏️';
    text = isNoOutline ? '不看框線，憑記憶寫' : '跟著筆順，一筆一筆寫';
    subtext = remaining > 0 ? `還有 ${remaining} 筆` : '最後一筆了！';
    colorClass = isNoOutline
      ? 'text-accent bg-accent/10'
      : 'text-emerald-700 bg-emerald-50';
  } else if (mode === 'idle') {
    icon = '✅';
    text = '這一輪寫完了！';
    colorClass = 'text-emerald-700 bg-emerald-50';
  }

  if (!text) return null;

  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-sm animate-slide-up-fast ${colorClass}`}>
      <span>{icon}</span>
      <span className="font-medium">{text}</span>
      {subtext && <span className="opacity-60 text-xs">{subtext}</span>}
    </div>
  );
}

/* ================================================================ */
/*  Toast                                                            */
/* ================================================================ */

export function Toast({ message, type }: { message: string; type: 'success' | 'error' | 'info' }) {
  const colors = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-tertiary text-white',
    info: 'bg-surface-container-highest text-on-surface',
  };
  return (
    <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-2xl text-sm font-bold z-50 animate-toast-in whitespace-nowrap ${colors[type]}`}>
      {message}
    </div>
  );
}

/* ================================================================ */
/*  ZhuyinDisplay (stub)                                             */
/*                                                                   */
/*  WriteCharacter itself does not render zhuyin — that layer lives  */
/*  in the parent VocabPractice component.  This stub is provided   */
/*  so future callers have a stable import point if zhuyin needs    */
/*  to move into WriteCharacter.                                     */
/* ================================================================ */

export interface ZhuyinDisplayProps {
  /** The character whose zhuyin should be rendered. */
  character: string;
  /** Optional CSS class for sizing / positioning. */
  className?: string;
}

/**
 * ZhuyinDisplay — displays the bopomofo (zhuyin) annotation for a character.
 *
 * Currently a thin placeholder; real zhuyin rendering is handled by
 * `frontend/src/components/zhuyin/` utilities used in VocabPractice.
 * Wire up the actual zhuyin lookup here when the feature moves into
 * WriteCharacter.
 */
export function ZhuyinDisplay({ character, className = '' }: ZhuyinDisplayProps) {
  // TODO: integrate with zhuyin lookup from frontend/src/components/zhuyin/
  // For now, renders nothing — keeps the import boundary clean.
  return <span className={`sr-only ${className}`} aria-label={`${character} 注音`} />;
}

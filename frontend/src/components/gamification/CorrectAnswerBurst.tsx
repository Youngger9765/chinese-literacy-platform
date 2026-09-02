/**
 * CorrectAnswerBurst — brief, non-blocking positive reinforcement shown the
 * instant a student answers a question correctly (Issue #3024).
 *
 * Teacher feedback from three on-site demos: 「答題答對時可以有即時增強或視覺
 * 進度條，讓學生覺得更有動機」— this is a purely cosmetic response to that.
 * It carries NO score, NO attempt count, and is only ever triggered on a
 * correct answer — never on a wrong one (see #3028 for why attempt-count- or
 * accuracy-based rewards are explicitly out of scope here; #2199 / #1094
 * deliberately hide "how many did you get right" and let the student retry
 * without penalty, and this component must not undo that).
 *
 * `pointer-events-none` + `aria-live="polite"` (not "assertive") so it can
 * never intercept a click on the "下一題" button and never steals focus —
 * BDD: 「這個回饋不會延遲或擋住進到下一題」。
 */
import React, { useEffect, useState } from 'react';

const MESSAGES = ['答對了！', '太棒了！', '做得好！', '真厲害！'] as const;
const VISIBLE_MS = 1100;

export interface CorrectAnswerBurstProps {
  /** Bump this (e.g. an incrementing counter) each time a correct answer
   * should re-trigger the burst. 0 (or unchanged) never shows anything. */
  triggerKey: number;
}

const CorrectAnswerBurst: React.FC<CorrectAnswerBurstProps> = ({ triggerKey }) => {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string>(MESSAGES[0]);

  useEffect(() => {
    if (triggerKey <= 0) return;
    setMessage(MESSAGES[triggerKey % MESSAGES.length]);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [triggerKey]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="correct-answer-burst"
      className="pointer-events-none fixed top-6 left-1/2 z-50 -translate-x-1/2 animate-[correct-burst-pop_0.25s_ease-out]"
    >
      <div className="flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 font-bold text-white shadow-lg">
        <span aria-hidden="true">✨</span>
        <span>{message}</span>
      </div>
      <style>{`
        @keyframes correct-burst-pop {
          0% { transform: scale(0.6) translateY(-6px); opacity: 0; }
          60% { transform: scale(1.08) translateY(0); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default CorrectAnswerBurst;

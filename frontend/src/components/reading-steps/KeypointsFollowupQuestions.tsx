/**
 * KeypointsFollowupQuestions — 第一篇專屬追問 (#2752 Phase 3, L0063-shape)
 *
 * `keypoints_followup_questions.questions[]`: bonus comprehension questions
 * that belong to 大題五 (文章重點表) but are scoped to the FIRST article only
 * (in a multi-text 合讀 lesson). The source YAML's own `note` explains why
 * this is a separate file rather than living in `comprehension`: that field
 * is already the combined (cross-text) comprehension quiz for the whole
 * lesson, so a part-1-only question set had nowhere else to go.
 *
 * Same self-check reveal pattern as ClassicalWordMatching.tsx (#2752 Phase 1).
 */
import React, { useState } from 'react';
import type { KeypointsFollowupQuestionsItem } from '../../types';

export interface KeypointsFollowupQuestionsProps {
  instruction?: string;
  questions: KeypointsFollowupQuestionsItem[];
}

const KeypointsFollowupQuestions: React.FC<KeypointsFollowupQuestionsProps> = ({ instruction, questions }) => {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  if (!questions || questions.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-surface-container-high bg-surface-container-lowest px-6 py-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-accent text-lg" aria-hidden="true">quiz</span>
        <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">第一篇加碼題</span>
      </div>
      {instruction && <p className="text-sm text-on-surface-variant">{instruction}</p>}
      {questions.map((q, i) => (
        <div key={i} className="space-y-2">
          <p className="text-base text-on-surface">{q.stem}</p>
          {q.options && (
            <ul className="pl-4 space-y-1 text-sm text-on-surface-variant">
              {Object.entries(q.options).map(([key, text]) => (
                <li key={key}>{key}. {text}</li>
              ))}
            </ul>
          )}
          {revealed[i] ? (
            <p className="text-sm text-accent">
              答案：{q.answer}
              {q.explanation && <span className="block text-on-surface-variant mt-1">{q.explanation}</span>}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setRevealed((r) => ({ ...r, [i]: true }))}
              className="text-sm text-accent hover:brightness-110 transition-colors"
            >
              顯示答案
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default KeypointsFollowupQuestions;

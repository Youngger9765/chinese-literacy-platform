/**
 * ListeningScoring — Phase 3 results display (Issue #1956)
 *
 * Renders the score card + key points covered/missed sections that were
 * previously embedded in the ListeningPractice monolith.
 */
import React from 'react';
import { ListeningEvaluateResponse } from '../../../services/learningApi';
import { encourageAccuracy } from '../../../utils/encouragement';
import { scoreColour } from './listeningUtils';

interface ListeningScoringProps {
  evalResult: ListeningEvaluateResponse;
}

const ListeningScoring: React.FC<ListeningScoringProps> = ({ evalResult }) => {
  const score = evalResult.score;

  return (
    <>
      {/* Feedback card — Issue #1094: student view hides numeric score, shows encouragement only */}
      <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-8 mt-4 flex flex-col items-center gap-4">
        <div
          className={`w-20 h-20 rounded-full flex items-center justify-center ${
            score >= 80
              ? 'bg-emerald-100'
              : score >= 60
              ? 'bg-amber-100'
              : 'bg-tertiary-container/30'
          }`}
        >
          <span className="material-symbols-outlined text-4xl" aria-hidden="true">
            {score >= 80 ? 'celebration' : score >= 60 ? 'thumb_up' : 'favorite'}
          </span>
        </div>
        <p className={`text-lg font-headline font-bold ${scoreColour(score)}`}>
          {encourageAccuracy(score)}
        </p>
        <p className="text-sm text-on-surface-variant text-center leading-relaxed">
          {evalResult.feedback}
        </p>
      </div>

      {/* Key points covered */}
      {evalResult.key_points_covered.length > 0 && (
        <div className="bg-emerald-50 rounded-3xl p-6 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-emerald-600">check_circle</span>
            <span className="font-headline font-bold text-emerald-700 text-sm">提到的重點</span>
          </div>
          <ul className="space-y-2">
            {evalResult.key_points_covered.map((point, i) => (
              <li key={i} className="text-sm text-emerald-800 leading-relaxed">
                • {point}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Key points missed */}
      {evalResult.key_points_missed.length > 0 && (
        <div className="bg-tertiary-container/10 rounded-3xl p-6 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-tertiary">info</span>
            <span className="font-headline font-bold text-tertiary text-sm">遺漏的重點</span>
          </div>
          <ul className="space-y-2">
            {evalResult.key_points_missed.map((point, i) => (
              <li key={i} className="text-sm text-on-surface leading-relaxed">
                • {point}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
};

export default ListeningScoring;

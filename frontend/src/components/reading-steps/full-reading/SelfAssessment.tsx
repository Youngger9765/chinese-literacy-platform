/**
 * SelfAssessment — 自評三級 UI for FullReading.
 *
 * Student picks their self-perceived fluency level (low/mid/high).
 * After selection, shows comparison with AI-computed rating.
 * Issue #1386
 */
import React from 'react';

export type AssessmentRating = 'low' | 'mid' | 'high';

interface SelfAssessmentProps {
  onSelect: (rating: AssessmentRating) => void;
  selectedRating?: AssessmentRating;
  /** AI-computed rating based on CPM vs threshold */
  aiRating?: AssessmentRating;
  /** Whether to show comparison (true after student has selected) */
  showComparison?: boolean;
}

const RATING_CONFIG: Record<AssessmentRating, { label: string; icon: string; bg: string; border: string; text: string }> = {
  low: {
    label: '需要加油',
    icon: 'sentiment_dissatisfied',
    bg: 'bg-tertiary-container/20 hover:bg-tertiary-container/30',
    border: 'border-tertiary-container',
    text: 'text-tertiary',
  },
  mid: {
    label: '還不錯',
    icon: 'sentiment_neutral',
    bg: 'bg-amber-50 hover:bg-amber-100',
    border: 'border-amber-300',
    text: 'text-amber-700',
  },
  high: {
    label: '非常流暢',
    icon: 'sentiment_very_satisfied',
    bg: 'bg-emerald-50 hover:bg-emerald-100',
    border: 'border-emerald-300',
    text: 'text-emerald-700',
  },
};

const RATING_LABELS: Record<AssessmentRating, string> = {
  low: '低',
  mid: '中',
  high: '高',
};

function ComparisonMessage({ selected, ai }: { selected: AssessmentRating; ai: AssessmentRating }) {
  const match = selected === ai;
  if (match) {
    return (
      <div className="mt-4 flex items-center gap-2 p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
        <span
          className="material-symbols-outlined text-emerald-600 text-lg"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
        <p className="text-sm text-emerald-700 font-headline">
          你的判斷跟 AI 一樣 — 很有自我認識！
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-start gap-2 p-3 rounded-2xl bg-surface-container-low border border-surface-container-high">
      <span
        className="material-symbols-outlined text-accent text-lg mt-0.5 shrink-0"
        style={{ fontVariationSettings: "'FILL' 0" }}
      >
        info
      </span>
      <p className="text-sm text-on-surface-variant font-headline">
        AI 覺得你這次讀得「
        <span className={`font-bold ${RATING_CONFIG[ai].text}`}>
          {RATING_LABELS[ai]}
        </span>
        」。每個人感受不一樣，繼續練習你會越來越準！
      </p>
    </div>
  );
}

const SelfAssessment: React.FC<SelfAssessmentProps> = ({
  onSelect,
  selectedRating,
  aiRating,
  showComparison = false,
}) => {
  const ratings: AssessmentRating[] = ['low', 'mid', 'high'];

  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
      <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider mb-1">
        自我評估
      </p>
      <p className="text-base font-headline text-on-surface mb-4">
        你覺得這次讀得怎麼樣？
      </p>

      <div className="flex gap-3">
        {ratings.map((rating) => {
          const cfg = RATING_CONFIG[rating];
          const isSelected = selectedRating === rating;
          return (
            <button
              key={rating}
              onClick={() => onSelect(rating)}
              disabled={!!selectedRating}
              className={`
                flex-1 flex flex-col items-center gap-2 py-4 px-2 rounded-2xl border-2 transition-all
                ${isSelected
                  ? `${cfg.bg.replace('hover:', '')} ${cfg.border} shadow-sm`
                  : selectedRating
                    ? 'border-surface-container-high bg-surface-container-low opacity-40 cursor-not-allowed'
                    : `${cfg.bg} border-transparent hover:border-current`
                }
              `}
              aria-label={`自評：${cfg.label}`}
              aria-pressed={isSelected}
            >
              <span
                className={`material-symbols-outlined text-2xl ${isSelected ? cfg.text : 'text-on-surface-variant'}`}
                style={{ fontVariationSettings: isSelected ? "'FILL' 1" : "'FILL' 0" }}
              >
                {cfg.icon}
              </span>
              <span className={`text-xs font-headline font-bold ${isSelected ? cfg.text : 'text-on-surface-variant'}`}>
                {cfg.label}
              </span>
            </button>
          );
        })}
      </div>

      {showComparison && selectedRating && aiRating && (
        <ComparisonMessage selected={selectedRating} ai={aiRating} />
      )}
    </div>
  );
};

export default SelfAssessment;

/**
 * SelfAssessment — 自評三級 UI for FullReading.
 *
 * Student picks their self-perceived fluency level (low/mid/high).
 * After selection, shows comparison with AI-computed rating.
 * Issue #1386
 */
import React from 'react';
import type { AiFluencyInsight } from '../../../utils/fluencyAnalyzer';

export type AssessmentRating = 'low' | 'mid' | 'high';

interface SelfAssessmentProps {
  onSelect: (rating: AssessmentRating) => void;
  selectedRating?: AssessmentRating;
  /** AI-computed rating based on CPM vs threshold */
  aiRating?: AssessmentRating;
  /** Objective fluency data for mismatch comparison copy */
  aiInsight?: AiFluencyInsight;
  /** Whether to show comparison (true after student has selected) */
  showComparison?: boolean;
  /** Which practice attempt this self-assessment is for (1-indexed).
   *  Per #1633: self-assessment overwrites, so only the latest one is kept —
   *  the attempt number provides the missing context. */
  attemptNumber?: number;
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

const RATING_RANK: Record<AssessmentRating, number> = {
  low: 0,
  mid: 1,
  high: 2,
};

function formatMetric(insight: AiFluencyInsight): string {
  return insight.metricUnit === 'cpm'
    ? `${insight.metricValue} 字/分鐘`
    : `${insight.metricValue} 秒`;
}

function buildMismatchMessage(selected: AssessmentRating, insight: AiFluencyInsight): string {
  const metricStr = formatMetric(insight);
  let message = `這次朗讀語速 ${metricStr}，落在「${insight.rangeLabel}」`;

  if (insight.gapToMidTier != null && insight.gapToMidTier > 0 && insight.midTierLabel) {
    const gapUnit = insight.metricUnit === 'cpm' ? '字/分鐘' : '秒';
    message += `，距離這篇建議區間（${insight.midTierLabel}）還差約 ${insight.gapToMidTier} ${gapUnit}`;
  }

  message += `。${insight.benchmarkFeedback}`;

  if (RATING_RANK[selected] > RATING_RANK[insight.rating]) {
    message += ' 你給自己的評價偏高，多練幾次會更熟悉自己的程度！';
  } else if (RATING_RANK[selected] < RATING_RANK[insight.rating]) {
    message += ' 其實表現比你想像好，繼續練自我判斷會更準！';
  }

  return message;
}

function ComparisonMessage({
  selected,
  ai,
  insight,
}: {
  selected: AssessmentRating;
  ai: AssessmentRating;
  insight?: AiFluencyInsight;
}) {
  const match = selected === ai;
  if (match) {
    const matchBody = insight?.benchmarkFeedback
      ? `你的判斷跟 AI 一樣 — 很有自我認識！${insight.benchmarkFeedback}`
      : '你的判斷跟 AI 一樣 — 很有自我認識！';
    return (
      <div className="mt-4 flex items-center gap-2 p-3 rounded-2xl bg-emerald-50 border border-emerald-200">
        <span
          className="material-symbols-outlined text-emerald-600 text-lg"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          check_circle
        </span>
        <p className="text-sm text-emerald-700 font-headline">
          {matchBody}
        </p>
      </div>
    );
  }

  const body = insight
    ? buildMismatchMessage(selected, insight)
    : '你和 AI 的判斷不太一樣，多練幾次會更熟悉自己的程度！';

  return (
    <div className="mt-4 flex items-start gap-2 p-3 rounded-2xl bg-surface-container-low border border-surface-container-high">
      <span
        className="material-symbols-outlined text-accent text-lg mt-0.5 shrink-0"
        style={{ fontVariationSettings: "'FILL' 0" }}
      >
        info
      </span>
      <p className="text-sm text-on-surface-variant font-headline">
        {body}
      </p>
    </div>
  );
}

const SelfAssessment: React.FC<SelfAssessmentProps> = ({
  onSelect,
  selectedRating,
  aiRating,
  aiInsight,
  showComparison = false,
  attemptNumber,
}) => {
  const ratings: AssessmentRating[] = ['low', 'mid', 'high'];

  return (
    <div className="bg-surface-container-lowest rounded-3xl shadow-editorial p-6">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-headline font-bold text-on-surface-variant uppercase tracking-wider">
          自我評估
        </p>
        {attemptNumber && attemptNumber > 0 && (
          <span className="text-[10px] font-headline text-on-surface-variant">
            第 {attemptNumber} 次練習
          </span>
        )}
      </div>
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
        <ComparisonMessage selected={selectedRating} ai={aiRating} insight={aiInsight} />
      )}
    </div>
  );
};

export default SelfAssessment;

import React from 'react';
import type { ComprehensionScoreFeedback } from '../../services/learningApi';

interface ComprehensionScoreCardProps {
  comprehensionScore: number;
  literalScore: number;
  inferentialScore: number;
  evaluativeScore: number;
  feedback: ComprehensionScoreFeedback | null;
  loading?: boolean;
  /** Issue #1094: hide numeric scores in student-facing view; show encouragement only */
  hideScores?: boolean;
}

const levelConfig = [
  {
    key: 'literal' as const,
    label: '字面理解',
    description: '回答課文中明確提到的事實',
    color: 'bg-blue-500',
    bgLight: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200',
  },
  {
    key: 'inferential' as const,
    label: '推論理解',
    description: '推測因果關係與隱含意義',
    color: 'bg-violet-500',
    bgLight: 'bg-violet-50',
    textColor: 'text-violet-700',
    borderColor: 'border-violet-200',
  },
  {
    key: 'evaluative' as const,
    label: '評鑑理解',
    description: '連結經驗、提出觀點與評論',
    color: 'bg-amber-500',
    bgLight: 'bg-amber-50',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-200',
  },
];

const getScoreLevel = (score: number) => {
  if (score >= 80) return { label: '優秀', textColor: 'text-emerald-600' };
  if (score >= 60) return { label: '良好', textColor: 'text-blue-600' };
  if (score >= 40) return { label: '加油', textColor: 'text-amber-600' };
  return { label: '待加強', textColor: 'text-red-500' };
};

const ComprehensionScoreCard: React.FC<ComprehensionScoreCardProps> = ({
  comprehensionScore,
  literalScore,
  inferentialScore,
  evaluativeScore,
  feedback,
  loading = false,
  hideScores = false,
}) => {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-surface p-6 animate-pulse">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-16 h-16 rounded-full bg-gray-200" />
          <div className="space-y-2">
            <div className="h-4 w-32 bg-gray-200 rounded" />
            <div className="h-3 w-48 bg-gray-200 rounded" />
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-100 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const scores = {
    literal: literalScore,
    inferential: inferentialScore,
    evaluative: evaluativeScore,
  };

  const overallLevel = getScoreLevel(comprehensionScore);

  return (
    <div className="rounded-2xl border border-slate-200 bg-surface overflow-hidden">
      {/* Header with overall score */}
      <div className="bg-gradient-to-r from-accent/5 to-violet-50 px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-4">
          {/* Score circle — teacher view only; student view just shows title + encouragement */}
          {!hideScores && (
            <div className="relative w-16 h-16 shrink-0">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                <circle
                  cx="32" cy="32" r="28"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="4"
                />
                <circle
                  cx="32" cy="32" r="28"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeDasharray={`${(comprehensionScore / 100) * 175.93} 175.93`}
                  strokeLinecap="round"
                  className="text-accent transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-black text-on-surface">{Math.round(comprehensionScore)}</span>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-lg font-bold text-on-surface">課文理解力評估</h3>
            {!hideScores && (
              <p className={`text-sm font-bold ${overallLevel.textColor}`}>
                {overallLevel.label}
              </p>
            )}
            {feedback?.overall && (
              <p className="text-xs text-gray-500 mt-1">{feedback.overall}</p>
            )}
          </div>
        </div>
      </div>

      {/* 3 level scores */}
      <div className="p-6 space-y-4">
        {levelConfig.map(level => {
          const score = scores[level.key];
          const scoreLevel = getScoreLevel(score);
          const feedbackText = feedback?.[level.key];

          return (
            <div key={level.key} className={`rounded-xl border ${level.borderColor} ${level.bgLight} p-4`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className={`text-sm font-bold ${level.textColor}`}>{level.label}</span>
                  <span className="text-xs text-gray-400 ml-2">{level.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  {hideScores ? (
                    <span className={`text-xs font-bold ${scoreLevel.textColor}`}>
                      {score >= 60 ? '達成' : '再努力'}
                    </span>
                  ) : (
                    <>
                      <span className={`text-xs font-bold ${scoreLevel.textColor}`}>{scoreLevel.label}</span>
                      <span className="text-lg font-black text-on-surface">{Math.round(score)}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-white/60 rounded-full h-2 mb-2">
                <div
                  className={`${level.color} h-2 rounded-full transition-all duration-700`}
                  style={{ width: `${Math.min(100, score)}%` }}
                />
              </div>

              {/* Feedback text */}
              {feedbackText && (
                <p className="text-xs text-gray-600 mt-2 leading-relaxed">{feedbackText}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ComprehensionScoreCard;

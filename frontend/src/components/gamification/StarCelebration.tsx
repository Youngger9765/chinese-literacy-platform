import React from 'react';
import StarRating from './StarRating';

export interface StarCelebrationProps {
  /** 1–3 stars based on performance */
  stars: 1 | 2 | 3;
  /** Reading accuracy percentage (0–100). Used for display. */
  readingAccuracy: number | null;
  /** Comprehension score percentage (0–100). Used for display. */
  comprehensionScore: number | null;
}

const STAR_CONFIG: Record<
  1 | 2 | 3,
  { label: string; bg: string; border: string; badge: string; badgeText: string; emoji: string }
> = {
  1: {
    label: '完成學習！繼續加油！',
    bg: 'from-blue-50 to-indigo-50',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
    badgeText: '參與獎',
    emoji: '👏',
  },
  2: {
    label: '表現很棒！',
    bg: 'from-amber-50 to-yellow-50',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700',
    badgeText: '優秀獎',
    emoji: '🎉',
  },
  3: {
    label: '太厲害了！完美表現！',
    bg: 'from-yellow-50 to-orange-50',
    border: 'border-yellow-300',
    badge: 'bg-yellow-100 text-yellow-700',
    badgeText: '滿分獎',
    emoji: '🏆',
  },
};

/**
 * Full star-rating card displayed at the top of AssessmentReport.
 * Shows 1–3 stars with a warm, encouraging message for elementary students.
 */
const StarCelebration: React.FC<StarCelebrationProps> = ({
  stars,
  readingAccuracy,
  comprehensionScore,
}) => {
  const cfg = STAR_CONFIG[stars];

  // Build sub-label from available scores
  const parts: string[] = [];
  if (readingAccuracy !== null) parts.push(`朗讀準確度 ${readingAccuracy}%`);
  if (comprehensionScore !== null) parts.push(`理解力 ${comprehensionScore}%`);
  const subLabel = parts.length > 0 ? parts.join('　｜　') : undefined;

  return (
    <div
      className={`rounded-3xl border-2 ${cfg.border} bg-gradient-to-br ${cfg.bg} p-8 flex flex-col items-center gap-4 shadow-sm`}
    >
      {/* Badge */}
      <div className="flex items-center gap-2">
        <span className="text-2xl">{cfg.emoji}</span>
        <span className={`text-sm font-black px-3 py-1 rounded-full ${cfg.badge}`}>
          {cfg.badgeText}
        </span>
        <span className="text-2xl">{cfg.emoji}</span>
      </div>

      {/* Animated star row */}
      <StarRating
        stars={stars}
        label={cfg.label}
        subLabel={subLabel}
        animationDelay={200}
      />

      {/* Scoring criteria hint */}
      <div className="mt-1 flex gap-3 text-xs text-gray-400">
        <span className={stars >= 1 ? 'text-gray-500 font-bold' : ''}>
          ★ 完成學習
        </span>
        <span className={stars >= 2 ? 'text-amber-600 font-bold' : ''}>
          ★★ 準確度 ≥ 70%
        </span>
        <span className={stars >= 3 ? 'text-yellow-600 font-bold' : ''}>
          ★★★ 準確度 ≥ 90%
        </span>
      </div>
    </div>
  );
};

export default StarCelebration;

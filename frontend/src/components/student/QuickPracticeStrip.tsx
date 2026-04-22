/**
 * QuickPracticeStrip — "想練點什麼？" section on StudentHome.
 *
 * 4 curated practice tool cards (fixed, no smart recommendation).
 * Smart recommendation by student weak-point is a future issue.
 *
 * Cards:
 *   - 筆順字帖  → /write          (no story needed)
 *   - 聽寫挑戰  → /library        (needs story — goes to library first)
 *   - 造句練習  → /library        (needs story)
 *   - 字典查詢  → /vocabulary     (no story needed)
 *
 * "看更多 →" links to /tools (PracticeToolbox page, Issue #1153).
 *
 * Issue #1153
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';

interface PracticeCard {
  icon: string;
  title: string;
  description: string;
  route: string;
  /** If true, a small "(先選課文)" hint is shown */
  needsStory?: boolean;
}

const QUICK_CARDS: PracticeCard[] = [
  {
    icon: '🖊️',
    title: '筆順字帖',
    description: '跟動畫練正確筆順',
    route: '/write',
  },
  {
    icon: '🎧',
    title: '聽寫挑戰',
    description: 'AI 唸字，你來打字',
    route: '/library',
    needsStory: true,
  },
  {
    icon: '✏️',
    title: '造句練習',
    description: '練習用詞語造好句',
    route: '/library',
    needsStory: true,
  },
  {
    icon: '📖',
    title: '字典查詢',
    description: '查字義、注音、例句',
    route: '/vocabulary',
  },
];

const QuickPracticeStrip: React.FC = () => {
  const navigate = useNavigate();

  return (
    <section aria-labelledby="quick-practice-title">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <h2
          id="quick-practice-title"
          className="text-base font-bold font-headline text-on-surface"
        >
          想練點什麼？
        </h2>
        <button
          type="button"
          onClick={() => navigate('/tools')}
          className="text-sm font-semibold text-accent hover:underline underline-offset-2 transition-colors"
          aria-label="查看更多練習工具"
        >
          看更多 →
        </button>
      </div>

      {/* 4-card grid: 2 cols always (student-friendly touch targets) */}
      <div className="grid grid-cols-2 gap-3">
        {QUICK_CARDS.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={() => navigate(card.route)}
            className="
              text-left bg-surface-container-lowest rounded-2xl border border-[#E5E0D5]
              hover:shadow-md hover:scale-[0.995] active:scale-[0.98]
              p-4 flex items-center gap-3 transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
              min-h-[72px]
            "
            aria-label={`${card.title}${card.needsStory ? '（先選課文）' : ''}`}
          >
            <div className="w-11 h-11 rounded-xl bg-accent-bg flex items-center justify-center shrink-0">
              <span className="text-2xl leading-none" aria-hidden="true">
                {card.icon}
              </span>
            </div>
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-sm font-bold text-on-surface leading-tight">
                {card.title}
              </p>
              <p className="text-xs text-on-surface-variant leading-snug">
                {card.description}
              </p>
              {card.needsStory && (
                <p className="text-xs text-accent/70 font-medium">先選課文</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
};

export default QuickPracticeStrip;

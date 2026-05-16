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
 * Hidden (Issue #1638): 字典查詢 removed from UI per 5/15 meeting.
 *   Backend DictionaryService preserved; /dictionary route still accessible directly.
 *
 * "看更多 →" links to /tools (PracticeToolbox page, Issue #1153).
 *
 * Issue #1153 + #1230
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
  // Hidden: 字典查詢 — removed from UI per 5/15 meeting (Issue #1638).
  // Backend DictionaryService and /api/dictionary/* endpoints are preserved.
  // The /dictionary route in AppRoutes.tsx is also preserved for direct access.
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

      {/* Horizontal shelf: scrollable tool cards (Variant B — no icon circles) */}
      <div
        className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory scrollbar-hide"
        role="list"
      >
        {QUICK_CARDS.map((card) => (
          <button
            key={card.title}
            type="button"
            role="listitem"
            onClick={() => navigate(card.route)}
            className="
              snap-start shrink-0 w-[140px] text-left
              bg-surface-container-lowest rounded-xl border border-[#E5E0D5]
              hover:border-accent hover:shadow-sm active:scale-[0.98]
              p-3 flex flex-col gap-1.5 transition-all duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
            "
            aria-label={`${card.title}${card.needsStory ? '（先選課文）' : ''}`}
          >
            <span className="text-lg leading-none" aria-hidden="true">
              {card.icon}
            </span>
            <p className="text-sm font-bold text-on-surface leading-tight">
              {card.title}
            </p>
            <p className="text-xs text-on-surface-variant leading-snug line-clamp-2">
              {card.description}
            </p>
            {card.needsStory && (
              <p className="text-[11px] text-accent/70 font-medium mt-auto">先選課文</p>
            )}
          </button>
        ))}
      </div>
    </section>
  );
};

export default QuickPracticeStrip;

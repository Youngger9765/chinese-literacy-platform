/**
 * LeagueBadgeCard — achievement badge visual for the league redesign
 * (PRD §12.1 item 7: we ship an achievement-badge card, not a swappable
 * profile avatar system — see that section for why).
 *
 * Reuses BadgeGrid.tsx's visual language (colored border/bg, grayscale +
 * lock overlay when locked) so this doesn't introduce a third badge style
 * into the app.
 */
import React from 'react';

interface LeagueBadgeCardProps {
  /** 'individual' = accent (brand purple), 'class' = tertiary (encouragement
   * orange) — PRD §12.2 decision #2, no new color tokens. */
  kind: 'individual' | 'class';
  earned: boolean;
  title: string;
  description: string;
}

const KIND_STYLE: Record<LeagueBadgeCardProps['kind'], { earned: string; icon: string }> = {
  individual: { earned: 'bg-accent-bg border-accent/60 shadow-sm', icon: '⭐' },
  class: { earned: 'bg-tertiary-container/20 border-tertiary-container shadow-sm', icon: '🏆' },
};

const LeagueBadgeCard: React.FC<LeagueBadgeCardProps> = ({ kind, earned, title, description }) => {
  const style = KIND_STYLE[kind];
  return (
    <div
      className={`relative flex flex-col items-center gap-1 p-3 rounded-2xl border-2 text-center transition-all ${
        earned ? style.earned : 'bg-surface-container-low border-surface-dim opacity-50 grayscale'
      }`}
      title={description}
    >
      {!earned && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
          <span className="text-on-surface-variant text-xl" aria-hidden="true">🔒</span>
        </div>
      )}
      <span className="text-2xl leading-none" aria-hidden="true">{style.icon}</span>
      <span className="text-xs font-bold text-on-surface leading-tight">{title}</span>
      <span className="text-[10px] text-on-surface-variant leading-tight">{description}</span>
    </div>
  );
};

export default LeagueBadgeCard;

/**
 * LeagueBadgeCard — achievement badge visual for the league redesign
 * (PRD §12.1 item 7: we ship an achievement-badge card, not a swappable
 * profile avatar system — see that section for why).
 *
 * Reuses BadgeGrid.tsx's visual language (colored border/bg, grayscale when
 * locked) with one deliberate change: BadgeGrid.tsx centers its lock emoji
 * with `absolute inset-0 flex items-center justify-center`, which lands
 * directly on top of whichever line sits at the card's vertical center.
 * BadgeGrid's taller 4-line layout (icon/name/description/unlock-date)
 * happens to put that center in empty space, but this card's shorter
 * 3-line layout put it squarely on the title text — the "icon overlaps
 * the title" defect reported 2026-10-16 (staging-teacher-battlehero-
 * scored-1280.png, staging-student-ourclass-scored-390.png). Fixed here by
 * pinning the lock to a corner badge instead of the card's center.
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
      className={`relative flex flex-col items-center gap-2 p-3 rounded-2xl border-2 text-center transition-all ${
        earned ? style.earned : 'bg-surface-container-low border-surface-dim opacity-50 grayscale'
      }`}
      title={description}
    >
      {!earned && (
        <span
          className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-container-lowest text-[11px] leading-none shadow-sm"
          aria-hidden="true"
        >
          🔒
        </span>
      )}
      <span className="text-2xl leading-snug" aria-hidden="true">{style.icon}</span>
      <span className="text-xs font-bold text-on-surface leading-tight">{title}</span>
      <span className="text-[10px] text-on-surface-variant leading-tight">{description}</span>
    </div>
  );
};

export default LeagueBadgeCard;

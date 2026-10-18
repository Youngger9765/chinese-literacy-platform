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
 *
 * 2026-10-16 (#3594): `title`/`description` are now theme-driven content
 * (chest/badge copy, PRD §13) passed in by the caller — this component no
 * longer hardcodes "班級徽章"/"神秘寶箱" etc. `icon` accepts a
 * `LeagueThemeArt` (emoji or sanitized SVG) instead of a hardcoded emoji
 * string, rendered via ArtGlyph; callers that don't have theme content yet
 * can still pass a plain emoji string for backward compatibility.
 */
import React from 'react';
import type { LeagueThemeArt } from '../../types/leagueTheme';
import ArtGlyph from './ArtGlyph';

interface LeagueBadgeCardProps {
  /** 'individual' = accent (brand purple), 'class' = tertiary (encouragement
   * orange) — PRD §12.2 decision #2, no new color tokens. */
  kind: 'individual' | 'class';
  earned: boolean;
  title: string;
  description: string;
  /** Theme-driven art (emoji or sanitized SVG). Falls back to the kind's
   * default emoji when omitted. */
  icon?: LeagueThemeArt;
}

const KIND_STYLE: Record<LeagueBadgeCardProps['kind'], { earned: string; defaultIcon: LeagueThemeArt }> = {
  individual: { earned: 'bg-accent-bg border-accent/60 shadow-sm', defaultIcon: { kind: 'emoji', value: '⭐' } },
  class: { earned: 'bg-tertiary-container/20 border-tertiary-container shadow-sm', defaultIcon: { kind: 'emoji', value: '🏆' } },
};

const LeagueBadgeCard: React.FC<LeagueBadgeCardProps> = ({ kind, earned, title, description, icon }) => {
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
      <ArtGlyph art={icon ?? style.defaultIcon} className="text-2xl leading-snug" />
      <span className="text-xs font-bold text-on-surface leading-tight">{title}</span>
      <span className="text-[10px] text-on-surface-variant leading-tight">{description}</span>
    </div>
  );
};

export default LeagueBadgeCard;

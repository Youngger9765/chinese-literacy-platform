/**
 * EnergyBar — a team's or student's progress toward the season's frozen
 * badge_threshold, drawn in the same visual language as
 * GamificationHero.tsx's XP bar (`bg-white/20` track + gradient fill) so
 * the "有質感" redesign feels like one app, not a bolted-on feature.
 *
 * 2026-10-16 UI redesign (#3554 follow-up, PRD §12.2 decision #1).
 */
import React from 'react';
import { energyPercent, displayPoints } from './leagueVisuals';

interface EnergyBarProps {
  label: string;
  points: number;
  threshold: number;
  badgeEarned: boolean;
  /** 'accent' (purple, used for the inviting/left team or an individual)
   * or 'tertiary' (warm orange, used for the invited/right team) — the
   * two existing system colors, not a new palette (PRD §12.2 decision #2). */
  tone?: 'accent' | 'tertiary';
}

const TONE_GRADIENT: Record<NonNullable<EnergyBarProps['tone']>, string> = {
  accent: 'from-accent-light to-white',
  tertiary: 'from-tertiary-container to-white',
};

const EnergyBar: React.FC<EnergyBarProps> = ({
  label,
  points,
  threshold,
  badgeEarned,
  tone = 'accent',
}) => {
  const pct = energyPercent(points, threshold);
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-white font-bold truncate">{label}</span>
        {badgeEarned ? (
          <span className="text-white font-bold flex items-center gap-1 shrink-0">
            <span aria-hidden="true">🏅</span>已達標
          </span>
        ) : (
          <span className="text-white/90 shrink-0 tabular-nums">
            {displayPoints(points)} / {displayPoints(threshold)}
          </span>
        )}
      </div>
      <div
        className="h-3 rounded-full bg-white/20 overflow-hidden"
        role="progressbar"
        aria-label={`${label} 能量進度`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r ${TONE_GRADIENT[tone]} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

export default EnergyBar;

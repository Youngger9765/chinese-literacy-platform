/**
 * BattleHero — "讀家星圖" battle home hero: two classrooms' energy bars
 * face-to-face with a shared badge threshold, plus each side's chest-unlock
 * hint. This is the Young-specified "大『清除進度』集體進度條，顯示兩隊能量
 * 並排" requirement (#3554 redesign brief), adapted per PRD §12.1 item 2 —
 * see that section for why this draws progress toward the real, frozen
 * `badge_threshold` instead of inventing an un-approved "3,000 units of
 * darkness" style global number.
 *
 * Visual language: reuses GamificationHero.tsx's purple gradient card +
 * white text + bg-white/20 progress track (PRD §12.2 decision #1 — no new
 * dark theme, stay consistent with the rest of the app). The "星圖"
 * (star-chart) flavor comes from a handful of inline-SVG dots, not a new
 * image asset or a forked color palette.
 */
import React from 'react';
import type { LeagueBoardRow } from '../../services/leagueApi';
import EnergyBar from './EnergyBar';
import { chestHintText } from './leagueVisuals';

interface BattleHeroProps {
  seasonName: string;
  /** Exactly two rows for an invitational season (PRD §4: always 2 teams). */
  rows: [LeagueBoardRow, LeagueBoardRow];
  /** Highlights the viewer's own classroom with a "我們班" tag. */
  viewerClassroomId: number | null;
  isFinalized: boolean;
}

// A handful of fixed-position decorative stars — purely CSS/SVG, no image
// asset, no Junyi artwork (CLAUDE.md IP boundary).
const STAR_POSITIONS = [
  { top: '8%', left: '12%', size: 6, delay: '0s' },
  { top: '18%', left: '82%', size: 4, delay: '0.4s' },
  { top: '55%', left: '6%', size: 4, delay: '0.8s' },
  { top: '70%', left: '92%', size: 6, delay: '1.2s' },
  { top: '38%', left: '48%', size: 3, delay: '1.6s' },
];

const StarField: React.FC = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
    {STAR_POSITIONS.map((s, i) => (
      <span
        key={i}
        className="absolute rounded-full bg-white/70 animate-pulse"
        style={{ top: s.top, left: s.left, width: s.size, height: s.size, animationDelay: s.delay }}
      />
    ))}
  </div>
);

interface TeamBlockProps {
  row: LeagueBoardRow;
  threshold: number;
  tone: 'accent' | 'tertiary';
  isViewer: boolean;
}

const TeamBlock: React.FC<TeamBlockProps> = ({ row, threshold, tone, isViewer }) => (
  <div className="flex-1 min-w-0">
    {isViewer && (
      <span className="inline-block mb-1 text-[10px] font-bold text-accent bg-white rounded-full px-2 py-0.5">
        我們班
      </span>
    )}
    <EnergyBar
      label={row.classroom_name}
      points={row.average_points}
      threshold={threshold}
      badgeEarned={row.team_badge_earned}
      tone={tone}
    />
    <p className="mt-1.5 text-[11px] text-white/80">
      {chestHintText(row.treasure_chest_eligible, row.treasure_chest_participants_needed)}
      {' · '}全班 {row.participant_count}/{row.roster_size} 人已參與
    </p>
  </div>
);

const BattleHero: React.FC<BattleHeroProps> = ({ seasonName, rows, viewerClassroomId, isFinalized }) => {
  const [left, right] = rows;
  const threshold = left.badge_threshold;

  return (
    <section
      aria-label="讀家星圖對戰進度"
      className="relative rounded-3xl bg-gradient-to-br from-accent to-accent/80 shadow-editorial overflow-hidden px-5 py-6 sm:px-8 sm:py-7"
    >
      <StarField />
      <div className="relative">
        <div className="flex items-center justify-between gap-2 mb-5">
          <h2 className="text-white font-headline font-bold text-lg sm:text-xl truncate">
            {seasonName}
          </h2>
          <span className="shrink-0 text-xs font-bold text-white/90 bg-white/15 rounded-full px-3 py-1">
            {isFinalized ? '已結束' : '進行中'}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch gap-3 sm:gap-4">
          <TeamBlock row={left} threshold={threshold} tone="accent" isViewer={left.classroom_id === viewerClassroomId} />

          <div
            className="shrink-0 self-center w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center font-black text-sm"
            aria-hidden="true"
          >
            VS
          </div>

          <TeamBlock row={right} threshold={threshold} tone="tertiary" isViewer={right.classroom_id === viewerClassroomId} />
        </div>
      </div>
    </section>
  );
};

export default BattleHero;

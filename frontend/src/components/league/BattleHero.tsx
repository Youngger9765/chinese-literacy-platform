/**
 * BattleHero — 跨班賽季 battle home hero: two classrooms' energy bars
 * face-to-face with a shared badge threshold, plus each side's chest-unlock
 * hint. This is the Young-specified "大『清除進度』集體進度條，顯示兩隊能量
 * 並排" requirement (#3554 redesign brief), adapted per PRD §12.1 item 2 —
 * see that section for why this draws progress toward the real, frozen
 * `badge_threshold` instead of inventing an un-approved "3,000 units of
 * darkness" style global number.
 *
 * Visual language: reuses GamificationHero.tsx's purple gradient card +
 * white text + bg-white/20 progress track (PRD §12.2 decision #1 — no new
 * dark theme, stay consistent with the rest of the app).
 *
 * 2026-10-16 (#3594): the narrative skin (title/era/intro/faction labels/
 * milestone captions/chest+badge copy/win-lose-draw text) is now driven by
 * `theme` (PRD §13) instead of a hardcoded "讀家星圖" star-map — replacing
 * the decorative StarField with the theme's `background_art` when present,
 * and no fox-cat/狐狸貓 (or any other reference-product IP) anywhere. The
 * UNCHANGED part is everything that touches scoring: `badge_threshold`,
 * `treasure_chest_participants_needed`, and the energy-bar math all still
 * come from leagueVisuals.ts / the frozen weights snapshot — `theme` only
 * supplies copy and art, never a number that changes what counts as a win.
 */
import React from 'react';
import type { LeagueBoardRow } from '../../services/leagueApi';
import type { LeagueTheme } from '../../types/leagueTheme';
import EnergyBar from './EnergyBar';
import ArtGlyph from './ArtGlyph';
import { chestHintText, energyPercent } from './leagueVisuals';
import { determineOutcome, pickMilestoneMessage, resultCopyFor } from './leagueTheme';

interface BattleHeroProps {
  theme: LeagueTheme;
  /** The real match identity (e.g. "跨班邀請賽：三年甲班 vs 五年乙班") —
   * kept separate from `theme.title` (the narrative skin's season title):
   * one says WHO is playing, the other says WHAT STORY this season is
   * telling. Both are shown. */
  seasonName: string;
  /** Exactly two rows for an invitational season (PRD §4: always 2 teams). */
  rows: [LeagueBoardRow, LeagueBoardRow];
  /** Highlights the viewer's own classroom with a "我們班" tag. */
  viewerClassroomId: number | null;
  isFinalized: boolean;
}

// Decorative star dots — the fallback backdrop when a theme has no
// `background_art` (still purely CSS/SVG, no image asset, no reference-
// product IP — CLAUDE.md IP boundary).
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

/** The era backdrop: the theme's own SVG art when present (subtle, low
 * opacity — PRD §12.2 decision #1, never a full theme swap of the card
 * chrome), else the generic star field. An `emoji`-kind background_art
 * doesn't make sense tiled as a backdrop, so that also falls back to
 * StarField rather than rendering oddly. */
const EraBackdrop: React.FC<{ art: LeagueTheme['background_art'] }> = ({ art }) => {
  if (!art || art.kind !== 'svg') return <StarField />;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-60" aria-hidden="true">
      <ArtGlyph art={art} className="block w-full h-full [&>svg]:w-full [&>svg]:h-full" />
    </div>
  );
};

interface TeamBlockProps {
  row: LeagueBoardRow;
  threshold: number;
  tone: 'accent' | 'tertiary';
  isViewer: boolean;
  factionLabel: string;
}

const TeamBlock: React.FC<TeamBlockProps> = ({ row, threshold, tone, isViewer, factionLabel }) => (
  <div className="flex-1 min-w-0">
    <div className="flex items-center gap-1.5 mb-1">
      {isViewer && (
        <span className="inline-block text-[10px] font-bold text-accent bg-white rounded-full px-2 py-0.5">
          我們班
        </span>
      )}
      <span className="text-[10px] font-medium text-white/70 truncate">{factionLabel}</span>
    </div>
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

const BattleHero: React.FC<BattleHeroProps> = ({ theme, seasonName, rows, viewerClassroomId, isFinalized }) => {
  const [left, right] = rows;
  const threshold = left.badge_threshold;
  const [factionLeft, factionRight] = theme.faction_labels;

  const furthestProgress = Math.max(
    energyPercent(left.average_points, threshold),
    energyPercent(right.average_points, threshold),
  ) / 100;
  const milestoneMessage = pickMilestoneMessage(theme, furthestProgress);

  const outcome = isFinalized ? determineOutcome(rows, viewerClassroomId) : null;

  return (
    <section
      aria-label={`${theme.era}${theme.title} · 跨班賽季對戰進度`}
      className="relative rounded-3xl bg-gradient-to-br from-accent to-accent/80 shadow-editorial overflow-hidden px-5 py-6 sm:px-8 sm:py-7"
    >
      <EraBackdrop art={theme.background_art} />
      <div className="relative">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="text-white font-headline font-bold text-lg sm:text-xl truncate">
            {theme.title}
          </h2>
          <span className="shrink-0 text-xs font-bold text-white/90 bg-white/15 rounded-full px-3 py-1">
            {isFinalized ? '已結束' : '進行中'}
          </span>
        </div>
        <p className="text-xs text-white/75 truncate">{seasonName}</p>
        {theme.intro[0] && (
          <p className="text-[11px] text-white/60 italic mt-0.5 mb-4 line-clamp-2">{theme.intro[0]}</p>
        )}

        <div className="flex flex-col sm:flex-row items-stretch gap-3 sm:gap-4">
          <TeamBlock
            row={left}
            threshold={threshold}
            tone="accent"
            isViewer={left.classroom_id === viewerClassroomId}
            factionLabel={factionLeft}
          />

          <div
            className="shrink-0 self-center w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center font-black text-sm"
            aria-hidden="true"
          >
            VS
          </div>

          <TeamBlock
            row={right}
            threshold={threshold}
            tone="tertiary"
            isViewer={right.classroom_id === viewerClassroomId}
            factionLabel={factionRight}
          />
        </div>

        {milestoneMessage && !isFinalized && (
          <p className="mt-4 text-center text-xs font-medium text-white/90">{milestoneMessage}</p>
        )}
        {outcome && (
          <p className="mt-4 text-center text-sm font-bold text-white">{resultCopyFor(theme, outcome)}</p>
        )}
      </div>
    </section>
  );
};

export default BattleHero;

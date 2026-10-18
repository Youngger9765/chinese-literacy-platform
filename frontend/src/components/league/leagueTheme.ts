/**
 * leagueTheme — pure presentation helpers for theme-driven content
 * (PRD §13). Picks a milestone caption and a win/lose/draw outcome;
 * deliberately does NOT read or touch `badge_threshold` /
 * `treasure_chest_participation_ratio` — those stay in leagueVisuals.ts /
 * the backend's frozen weights snapshot. This file only chooses which
 * piece of COPY to show for an already-computed progress/score.
 */
import type { LeagueBoardRow } from '../../services/leagueApi';
import type { LeagueTheme } from '../../types/leagueTheme';

export type BattleOutcome = 'win' | 'lose' | 'draw';

/** The highest milestone whose ratio has been crossed by `progressRatio`
 * (0-1, same units as `LeagueThemeMilestone.ratio` / `energyPercent()/100`).
 * Returns null below the first milestone (including exactly 0) or for a
 * theme with no milestones — callers simply don't render a caption then. */
export function pickMilestoneMessage(theme: LeagueTheme, progressRatio: number): string | null {
  if (!Number.isFinite(progressRatio) || progressRatio <= 0) return null;
  let picked: string | null = null;
  for (const m of theme.milestones) {
    if (progressRatio >= m.ratio) picked = m.message;
  }
  return picked;
}

/** Win/lose/draw relative to `viewerClassroomId`. Falls back to the LEFT
 * row's (`rows[0]`) perspective when the viewer is unknown (null, e.g. the
 * student BattleHero today passes null — PRD §12.1 item 3 limitation) or
 * doesn't match either row — same "left is the stable reference" choice
 * BattleHero.tsx already makes for `threshold`. */
export function determineOutcome(
  rows: [LeagueBoardRow, LeagueBoardRow],
  viewerClassroomId: number | null,
): BattleOutcome {
  const [left, right] = rows;
  const viewerIsRight = viewerClassroomId != null && right.classroom_id === viewerClassroomId;
  const viewerRow = viewerIsRight ? right : left;
  const otherRow = viewerIsRight ? left : right;
  if (viewerRow.average_points === otherRow.average_points) return 'draw';
  return viewerRow.average_points > otherRow.average_points ? 'win' : 'lose';
}

export function resultCopyFor(theme: LeagueTheme, outcome: BattleOutcome): string {
  return theme.result_copy[outcome];
}

/** Client-side fallback theme — used only defensively, if an API response
 * is ever missing `theme` (e.g. a stale cached response from before this
 * feature shipped). The real backend always includes it (additive field,
 * see routes/league.py); this exists so a render never crashes on
 * `undefined.chest.name` (#2279 TDZ/crash postmortem doctrine). Copy
 * intentionally matches the OLD 讀家星圖 placeholder text it's replacing,
 * not a new theme — it is a safety net, not a third shipped theme. */
export const DEFAULT_THEME_FALLBACK: LeagueTheme = {
  schema_version: 1,
  key: 'fallback',
  era: '讀家',
  title: '跨班賽季',
  intro: ['和別班比幾週，平常讀課文就累積'],
  faction_labels: ['甲隊', '乙隊'],
  energy_bar_label: '能量',
  milestones: [],
  background_art: null,
  chest: { name: '神秘寶箱', description: '全班過半參與即可解鎖', art: { kind: 'emoji', value: '📦' } },
  badges: [
    {
      key: 'individual_badge',
      name: '個人徽章',
      description: '累積達標即可解鎖',
      art: { kind: 'emoji', value: '⭐' },
    },
    {
      key: 'class_badge',
      name: '班級徽章',
      description: '班級平均達標即可解鎖',
      art: { kind: 'emoji', value: '🏆' },
    },
  ],
  result_copy: { win: '這一局由你們拿下！', lose: '這一局對手領先，再接再厲', draw: '勢均力敵，不分勝負' },
};

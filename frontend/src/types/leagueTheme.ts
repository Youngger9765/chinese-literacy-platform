/**
 * TS mirror of backend/app/schemas/league_theme.py — the editable
 * storyline/chest/badge content for 跨班賽季. See that module's docstring
 * for the validation rules (enforced server-side; these types are for
 * render-time shape safety, not re-validation).
 *
 * PRD §13. Scoring (league_scoring.py / LeagueWeights) has NO representation
 * here — this file is content only.
 */

export type LeagueThemeArtKind = 'emoji' | 'svg';

export interface LeagueThemeArt {
  kind: LeagueThemeArtKind;
  value: string;
}

export interface LeagueThemeMilestone {
  ratio: number; // (0, 1]
  message: string;
}

export interface LeagueThemeChest {
  name: string;
  description: string;
  art: LeagueThemeArt;
}

/** Fixed mechanic keys — see backend BADGE_KEY_INDIVIDUAL / BADGE_KEY_CLASS.
 * A theme's badges array must cover exactly these two, never invent a third. */
export type LeagueThemeBadgeKey = 'individual_badge' | 'class_badge';

export interface LeagueThemeBadge {
  key: LeagueThemeBadgeKey;
  name: string;
  description: string;
  art: LeagueThemeArt;
}

export interface LeagueThemeResultCopy {
  win: string;
  lose: string;
  draw: string;
}

export interface LeagueTheme {
  schema_version: 1;
  key: string;
  era: string;
  title: string;
  intro: string[];
  faction_labels: [string, string];
  energy_bar_label: string;
  milestones: LeagueThemeMilestone[];
  background_art: LeagueThemeArt | null;
  chest: LeagueThemeChest;
  badges: LeagueThemeBadge[];
  result_copy: LeagueThemeResultCopy;
}

export interface LeagueThemeSummary {
  key: string;
  era: string;
  title: string;
  is_builtin: boolean;
}

export function findBadge(
  theme: LeagueTheme,
  key: LeagueThemeBadgeKey,
): LeagueThemeBadge | undefined {
  return theme.badges.find((b) => b.key === key);
}

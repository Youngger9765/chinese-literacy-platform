/**
 * badgeMeta — shared icon/name lookup for badge keys (Issue #3024).
 *
 * Extracted from XPAwardToast so BadgeUnlockToast (mid-session unlock, #3024)
 * can render the same icon/name for a badge key without duplicating the map
 * or drifting from it. Keys must match backend/app/models/gamification.py's
 * BADGE_CATALOGUE — there is no runtime check that these stay in sync, so any
 * new badge key added there should get an entry here too (falls back to a
 * generic medal + the raw key otherwise, never throws).
 */

export const BADGE_ICONS: Record<string, string> = {
  first_story: '⭐',
  story_5:     '📖',
  story_10:    '📚',
  story_25:    '🏛',
  streak_3:    '🔥',
  streak_7:    '🔥',
  streak_30:   '🏆',
  accuracy_90: '🎤',
  accuracy_100:'🎖',
  level_5:     '🧠',
  level_10:    '👑',
  xp_500:      '⚡',
  xp_1000:     '⚡',
  first_session:'⭐',
  perfect_week: '📅',
  explorer:     '🧭',
};

export const BADGE_NAMES: Record<string, string> = {
  first_story: '第一步',
  story_5:     '勤讀者',
  story_10:    '閱讀達人',
  story_25:    '博覽群書',
  streak_3:    '三日不輟',
  streak_7:    '週週精進',
  streak_30:   '月月堅持',
  accuracy_90: '精準朗讀',
  accuracy_100:'完美表現',
  level_5:     '思考者',
  level_10:    '國文之星',
  xp_500:      '積分達人',
  xp_1000:     '千分英雄',
  first_session:'初次學習',
  perfect_week: '完美一週',
  explorer:     '步步探索',
};

export function badgeIcon(key: string): string {
  return BADGE_ICONS[key] ?? '🏅';
}

export function badgeName(key: string): string {
  return BADGE_NAMES[key] ?? key;
}

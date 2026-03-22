/**
 * Gamification API service.
 * Wraps all calls to /api/gamification/* endpoints.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface LevelInfo {
  level: number;
  level_name: string;
  total_xp: number;
  current_level_xp: number;
  next_level_xp: number | null;
  xp_to_next: number;
  progress_pct: number;
}

export interface BadgeInfo {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  unlocked: boolean;
  unlocked_at?: string;
}

export interface StreakInfo {
  current: number;
  longest: number;
  last_activity_date: string | null;
}

export interface XPBreakdownEntry {
  event_type: string;
  xp: number;
  note: string;
}

export interface GamificationSummary {
  student_id: number;
  total_xp: number;
  stories_completed: number;
  level_info: LevelInfo;
  streak: StreakInfo;
  badges: BadgeInfo[];
  all_badges: BadgeInfo[];
}

export interface SessionCompletionResult {
  xp_earned: number;
  xp_breakdown: XPBreakdownEntry[];
  new_total_xp: number;
  level_info: LevelInfo;
  streak: StreakInfo;
  badges_unlocked: string[];
  notes: string[];
}

export interface LeaderboardEntry {
  rank: number;
  student_id: number;
  name: string;
  total_xp: number;
  level: number;
  stories_completed: number;
}

export interface LeaderboardResponse {
  classroom_id: number | null;
  entries: LeaderboardEntry[];
  total_students: number;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch the full gamification summary for a student.
 */
export async function fetchGamificationSummary(
  studentId: number,
  token: string
): Promise<GamificationSummary> {
  const res = await fetch(`${API_BASE}/api/gamification/summary/${studentId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`fetchGamificationSummary failed: ${res.status}`);
  return res.json();
}

/**
 * Award XP and badges when a learning session is completed.
 * Idempotent: safe to call multiple times for the same session.
 */
export async function awardSessionCompletion(
  studentId: number,
  sessionId: number,
  readingAccuracy: number | null,
  comprehensionPassed: boolean,
  token: string
): Promise<SessionCompletionResult> {
  const res = await fetch(`${API_BASE}/api/gamification/session-complete`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      student_id: studentId,
      session_id: sessionId,
      reading_accuracy: readingAccuracy,
      comprehension_passed: comprehensionPassed,
    }),
  });
  if (!res.ok) throw new Error(`awardSessionCompletion failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch classroom leaderboard.
 */
export async function fetchLeaderboard(
  classroomId: number,
  token: string,
  limit = 10
): Promise<LeaderboardResponse> {
  const res = await fetch(
    `${API_BASE}/api/gamification/leaderboard/${classroomId}?limit=${limit}`,
    { headers: authHeaders(token) }
  );
  if (!res.ok) throw new Error(`fetchLeaderboard failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch achievements (unlocked badges + full catalogue) for a student.
 */
export async function fetchAchievements(
  studentId: number,
  token: string
): Promise<{ badges: BadgeInfo[]; all_badges: BadgeInfo[]; total_unlocked: number }> {
  const res = await fetch(`${API_BASE}/api/gamification/achievements/${studentId}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`fetchAchievements failed: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Aliases — formerly in api.ts, consolidated here (Issue #646)
// ---------------------------------------------------------------------------

/** @alias LevelInfo */
export type GamificationLevelInfo = LevelInfo;
/** @alias StreakInfo */
export type GamificationStreak = StreakInfo;
/** @alias BadgeInfo */
export type GamificationBadge = BadgeInfo;

/** Alias for fetchGamificationSummary — matches legacy api.ts signature (studentId first). */
export async function getGamificationSummary(
  studentId: number,
  token: string,
): Promise<GamificationSummary> {
  return fetchGamificationSummary(studentId, token);
}

export async function getGamificationPoints(
  studentId: number,
  token: string,
): Promise<{ student_id: number; total_xp: number; stories_completed: number; level_info: LevelInfo }> {
  const res = await fetch(`${API_BASE}/api/gamification/points/${studentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getGamificationPoints failed: ${res.status}`);
  return res.json();
}

export async function getGamificationStreak(
  studentId: number,
  token: string,
): Promise<StreakInfo & { student_id: number }> {
  const res = await fetch(`${API_BASE}/api/gamification/streak/${studentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getGamificationStreak failed: ${res.status}`);
  return res.json();
}

export async function getClassroomLeaderboard(
  classroomId: number,
  token: string,
  limit = 10,
): Promise<LeaderboardResponse> {
  return fetchLeaderboard(classroomId, token, limit);
}

export async function reportSessionComplete(
  studentId: number,
  sessionId: number,
  token: string,
  opts: { readingAccuracy?: number; comprehensionPassed?: boolean } = {},
): Promise<{
  xp_earned: number;
  new_total_xp: number;
  level_info: LevelInfo;
  streak: StreakInfo;
  badges_unlocked: string[];
}> {
  const res = await fetch(`${API_BASE}/api/gamification/session-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      student_id: studentId,
      session_id: sessionId,
      reading_accuracy: opts.readingAccuracy ?? null,
      comprehension_passed: opts.comprehensionPassed ?? false,
    }),
  });
  if (!res.ok) throw new Error(`reportSessionComplete failed: ${res.status}`);
  return res.json();
}

import { API_BASE } from './apiConfig';
import type { LeagueTheme } from '../types/leagueTheme';
/**
 * League API service — cross-class invitational seasons, class-average
 * boards, personal "my team" summary, and 讀家記憶 history.
 *
 * See docs/prd/2026-10-14-chinese-star-league-prd.md §7/§10/§11/§13.
 * Follows the same pattern as semesterApi.ts.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface LeagueInvitation {
  id: number;
  code: string;
  inviter_classroom_id: number;
  invitee_classroom_id: number | null;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  game_start: string;
  game_end: string;
}

export interface LeagueBoardRow {
  team_id: number;
  classroom_id: number;
  classroom_name: string;
  grade: number;
  roster_size: number;
  participant_count: number;
  average_points: number;
  team_badge_earned: boolean;
  treasure_chest_eligible: boolean;
  /** Frozen per-season threshold (PRD §5 weights are versioned/frozen —
   * never hardcode 120 on the frontend). Added 2026-10-16 UI redesign. */
  badge_threshold: number;
  /** 0 once `treasure_chest_eligible` is true. Added 2026-10-16 so the
   * "還差 N 人解鎖寶箱" hint doesn't need the ratio recomputed client-side. */
  treasure_chest_participants_needed: number;
  rank: number;
}

export interface LeagueSeasonBoard {
  season_id: number;
  season_name: string;
  board: LeagueBoardRow[];
  /** Added 2026-10-16 (#3594) — the resolved storyline/chest/badge content
   * for this season (season override -> platform active default ->
   * shipped builtin default). Render code should still fall back to
   * `leagueTheme.ts`'s DEFAULT_THEME_FALLBACK if this is ever missing
   * (older cached response), not assume it's always present at runtime
   * even though the real backend contract always sends it. */
  theme: LeagueTheme;
}

export interface LeagueMySummary {
  season_id: number;
  season_name: string;
  my_points: number;
  my_lessons_counted: number;
  individual_badge_earned: boolean;
  class_average_points: number;
  class_badge_earned: boolean;
  participant_count: number;
  roster_size: number;
  /** Added 2026-10-16 UI redesign — see LeagueBoardRow for why this must
   * come from the response, not a hardcoded constant. */
  badge_threshold: number;
  treasure_chest_eligible: boolean;
  treasure_chest_participants_needed: number;
  /** Added 2026-10-16 (#3594) — see LeagueSeasonBoard.theme. */
  theme: LeagueTheme;
}

export interface LeagueClassroomSeason {
  season_id: number;
  name: string;
  game_start: string;
  game_end: string;
  is_finalized: boolean;
}

export interface LeagueAnomalyEntry {
  student_id: number;
  student_name: string;
  anomalies: { story_slug: string; reason: 'too_fast' | 'daily_cap_exceeded' }[];
}

// ── Error class ───────────────────────────────────────────────────────────────

export class LeagueApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LeagueApiError';
    this.status = status;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new LeagueApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// ── Invitations ───────────────────────────────────────────────────────────────

export async function createInvitation(
  token: string,
  data: {
    inviter_classroom_id: number;
    inviter_team_grade: number;
    game_start: string;
    game_end: string;
  },
): Promise<LeagueInvitation> {
  const res = await fetch(`${API_BASE}/api/league/invitations`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<LeagueInvitation>(res);
}

export async function listInvitations(
  token: string,
  classroomId: number,
): Promise<LeagueInvitation[]> {
  const res = await fetch(`${API_BASE}/api/league/invitations?classroom_id=${classroomId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueInvitation[]>(res);
}

export interface LeagueInvitationPreview {
  code: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  inviter_classroom_name: string;
  inviter_team_grade: number;
  game_start: string;
  game_end: string;
}

export async function previewInvitation(
  token: string,
  code: string,
): Promise<LeagueInvitationPreview> {
  const res = await fetch(`${API_BASE}/api/league/invitations/${code}/preview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueInvitationPreview>(res);
}

export async function acceptInvitation(
  token: string,
  code: string,
  data: { invitee_classroom_id: number; invitee_team_grade: number },
): Promise<LeagueInvitation> {
  const res = await fetch(`${API_BASE}/api/league/invitations/${code}/accept`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<LeagueInvitation>(res);
}

export async function declineInvitation(
  token: string,
  code: string,
  invitee_classroom_id: number,
): Promise<LeagueInvitation> {
  // 2026-10-15 — backend now requires invitee_classroom_id in the body
  // (mirrors acceptInvitation's contract exactly, see backend/app/routes/
  // league.py decline_invitation's security fix). Previously this sent no
  // body at all, which the new backend contract rejects with 422.
  const res = await fetch(`${API_BASE}/api/league/invitations/${code}/decline`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ invitee_classroom_id }),
  });
  return handleResponse<LeagueInvitation>(res);
}

export async function revokeInvitation(
  token: string,
  invitationId: number,
): Promise<LeagueInvitation> {
  const res = await fetch(`${API_BASE}/api/league/invitations/${invitationId}/revoke`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return handleResponse<LeagueInvitation>(res);
}

// ── Seasons / boards ──────────────────────────────────────────────────────────

export async function listClassroomSeasons(
  token: string,
  classroomId: number,
): Promise<LeagueClassroomSeason[]> {
  const res = await fetch(`${API_BASE}/api/league/classrooms/${classroomId}/seasons`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueClassroomSeason[]>(res);
}

export async function getSeasonBoard(token: string, seasonId: number): Promise<LeagueSeasonBoard> {
  const res = await fetch(`${API_BASE}/api/league/seasons/${seasonId}/board`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueSeasonBoard>(res);
}

export async function getMySeasonSummary(
  token: string,
  seasonId: number,
): Promise<LeagueMySummary> {
  const res = await fetch(`${API_BASE}/api/league/seasons/${seasonId}/my-summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueMySummary>(res);
}

export interface LeagueRosterProgressEntry {
  student_id: number;
  student_name: string;
  points: number;
  participated: boolean;
}

export async function getTeamRosterProgress(
  token: string,
  seasonId: number,
  teamId: number,
): Promise<LeagueRosterProgressEntry[]> {
  const res = await fetch(
    `${API_BASE}/api/league/seasons/${seasonId}/teams/${teamId}/roster`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<LeagueRosterProgressEntry[]>(res);
}

export async function getTeamAnomalies(
  token: string,
  seasonId: number,
  teamId: number,
): Promise<LeagueAnomalyEntry[]> {
  const res = await fetch(
    `${API_BASE}/api/league/seasons/${seasonId}/teams/${teamId}/anomalies`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return handleResponse<LeagueAnomalyEntry[]>(res);
}

// ── 讀家記憶 ───────────────────────────────────────────────────────────────────

export async function getMyLeagueHistory(
  token: string,
  studentId?: number,
): Promise<LeagueMySummary[]> {
  const qs = studentId != null ? `?student_id=${studentId}` : '';
  const res = await fetch(`${API_BASE}/api/league/my-history${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueMySummary[]>(res);
}

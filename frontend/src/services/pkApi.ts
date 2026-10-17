/**
 * PK 對戰 (雙人 PK 模式) API client — issue #3586. `/api/pk/*` +
 * `/api/classrooms/{id}/pk-activity`. Follows the same pattern as
 * liveQuizApi.ts (this repo's closest sibling feature).
 */
import { onApiUnauthorized } from './sessionGuard';
import { API_BASE } from './apiConfig';

export class PkApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PkApiError';
    this.status = status;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// #3610: every PK screen shows `PkApiError.message` to the student as-is.
// A server detail that isn't Chinese (an unhandled 500, a FastAPI 422
// validation array, a stray English detail) must never reach a child's
// screen — swap it for a Chinese message. Chinese details pass through.
const HAS_CJK = /[一-鿿]/;
const PK_GENERIC_ERROR = '發生錯誤，請稍後再試一次';

function studentFacingMessage(detail: unknown): string {
  return typeof detail === 'string' && HAS_CJK.test(detail) ? detail : PK_GENERIC_ERROR;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    onApiUnauthorized(res);
    let detail: unknown = undefined;
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.message;
    } catch {
      // ignore JSON parse errors
    }
    throw new PkApiError(studentFacingMessage(detail), res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Types (mirrors services/pk/engine.py + matchmaking.py response shapes) ---

export type PkScopeType = 'lesson' | 'grade_pool';

export interface PkQueueJoinResponse {
  queue_id: number;
  status: 'waiting' | 'matched' | 'expired' | 'cancelled';
  match_id: number | null;
}

export interface PkQueuePollResponse {
  queue_id: number;
  status: 'waiting' | 'matched' | 'expired' | 'cancelled';
  version: number;
  match_id: number | null;
  suggest_ai: boolean;
  unchanged?: boolean;
}

export interface PkInviteResponse {
  queue_id: number;
  invite_code: string;
  invite_expires_at: string;
}

export interface PkOpponent {
  tier: number;
  slug: string;
  name: string;
  speed_label: string;
  icon_url: string;
  portrait_url: string;
  recommended: boolean;
  unlocked: boolean;
  previously_played: boolean;
}

export interface PkOpponentsResponse {
  opponents: PkOpponent[];
}

export interface PkChallengeAiResponse {
  match_id: number;
}

export interface PkOption {
  key: string;
  text: string;
  /** #3621 — see LiveQuizOption in liveQuizApi.ts for the same field on
   *  the live-quiz side; PK reuses the same backend round-generation code
   *  so the shape is identical. */
  image?: string;
}

export interface PkRoundView {
  item_id: string | null;
  source_module: string;
  lesson_title: string;
  stem: string;
  options: PkOption[];
  seconds: number;
  extra?: { target_index: number } | null;
  my_choice_key: string | null;
  my_answered: boolean;
  correct_key?: string;
  opponent_choice_key?: string | null;
  opponent_is_correct?: boolean;
}

export interface PkMatchState {
  match_id: number;
  status: 'active' | 'completed' | 'abandoned';
  version: number;
  server_now: string;
  round_index: number;
  rounds_total: number;
  revealing: boolean;
  round_started_at: string | null;
  seconds: number;
  round: PkRoundView | null;
  my_name: string | null;
  opponent_name: string | null;
  my_score: number;
  opponent_score: number;
  opponent_type: 'AI' | 'player';
  bot_tier: number | null;
  suggest_ai: boolean;
  winner_side?: 'me' | 'opponent' | 'draw';
  /** Issue #3602 B6 / PRD §11 "AI 對戰時附帶當前應顯示的人物表情" — null for a
   * human match (see data/pkFigures.ts PkExpressionKey for the value set). */
  ai_expression?: string | null;
}

export interface PkAnswerResult {
  round_index: number;
  is_correct: boolean;
  points: number;
}

export interface PkRoundResult {
  round_index: number;
  stem: string;
  options: PkOption[];
  correct_key: string;
  my_choice_key: string | null;
  my_is_correct: boolean;
  opponent_choice_key: string | null;
  opponent_is_correct: boolean;
}

export interface PkMatchResult {
  match_id: number;
  outcome: 'win' | 'loss' | 'draw';
  my_score: number;
  opponent_score: number;
  opponent_type: 'AI' | 'player';
  bot_tier: number | null;
  rating_before: number | null;
  rating_after: number | null;
  rounds: PkRoundResult[];
  newly_unlocked_tier: number | null;
}

export interface PkHistoryEntry {
  match_id: number;
  status: string;
  opponent_type: 'AI' | 'player';
  bot_tier: number | null;
  my_score: number;
  opponent_score: number;
  outcome: 'win' | 'loss' | 'draw' | null;
  started_at: string;
  completed_at: string | null;
}

export interface PkClassroomActivity {
  classroom_id: number;
  matches_count: number;
  students: { student_id: number; name: string; has_participated: boolean }[];
}

// --- API functions ---

export async function joinPkQueue(
  token: string,
  body: { scope_type: PkScopeType; scope_ref: string; classroom_id?: number | null; invite_code?: string },
): Promise<PkQueueJoinResponse> {
  const res = await fetch(`${API_BASE}/api/pk/queue`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function pollPkQueue(
  token: string,
  queueId: number,
  afterVersion?: number,
): Promise<PkQueuePollResponse> {
  const qs = afterVersion != null ? `?after_version=${encodeURIComponent(String(afterVersion))}` : '';
  const res = await fetch(`${API_BASE}/api/pk/queue/${encodeURIComponent(String(queueId))}/poll${qs}`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function cancelPkQueue(token: string, queueId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/pk/queue/${encodeURIComponent(String(queueId))}/cancel`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function createPkInvite(
  token: string,
  body: { scope_type: PkScopeType; scope_ref: string; classroom_id: number },
): Promise<PkInviteResponse> {
  const res = await fetch(`${API_BASE}/api/pk/invite`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function getPkOpponents(token: string): Promise<PkOpponentsResponse> {
  const res = await fetch(`${API_BASE}/api/pk/opponents`, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function challengePkAi(
  token: string,
  body: { scope_type: PkScopeType; scope_ref: string; bot_tier: number; classroom_id?: number | null },
): Promise<PkChallengeAiResponse> {
  const res = await fetch(`${API_BASE}/api/pk/challenge-ai`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function getPkMatchState(
  token: string,
  matchId: number,
  afterVersion?: number,
): Promise<PkMatchState> {
  const qs = afterVersion != null ? `?after_version=${encodeURIComponent(String(afterVersion))}` : '';
  const res = await fetch(`${API_BASE}/api/pk/matches/${encodeURIComponent(String(matchId))}/state${qs}`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function submitPkAnswer(
  token: string,
  matchId: number,
  choiceKey: string,
): Promise<PkAnswerResult> {
  const res = await fetch(`${API_BASE}/api/pk/matches/${encodeURIComponent(String(matchId))}/answer`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ choice_key: choiceKey }),
  });
  return handleResponse(res);
}

export async function getPkMatchResult(token: string, matchId: number): Promise<PkMatchResult> {
  const res = await fetch(`${API_BASE}/api/pk/matches/${encodeURIComponent(String(matchId))}/result`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function getPkHistory(token: string): Promise<{ matches: PkHistoryEntry[] }> {
  const res = await fetch(`${API_BASE}/api/pk/history`, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function getPkRatingMe(
  token: string,
): Promise<{ rating: number; matches_played: number; wins: number; losses: number; draws: number }> {
  const res = await fetch(`${API_BASE}/api/pk/rating/me`, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function getClassroomPkActivity(
  token: string,
  classroomId: number,
): Promise<PkClassroomActivity> {
  const res = await fetch(`${API_BASE}/api/classrooms/${encodeURIComponent(String(classroomId))}/pk-activity`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

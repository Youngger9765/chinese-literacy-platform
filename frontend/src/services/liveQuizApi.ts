/**
 * Live Quiz (課堂搶答, page title 班級經營) API client — issue #3551.
 * `/api/live-quiz/*`. Follows the same pattern as classroomApi.ts.
 *
 * 競賽 is a different, future, long-term league module — unrelated to this
 * file. See backend specs/modules/live-quiz/INTENT.md for the naming note.
 */
import { onApiUnauthorized } from './sessionGuard';
import { API_BASE } from './apiConfig';

export class LiveQuizApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LiveQuizApiError';
    this.status = status;
  }
}

// The game code is 6 digits (see backend services/live_quiz/codes.py), and
// it reaches this file two ways: typed by hand (already sanitized to
// digits-only by StudentLiveQuizJoin) and from a route param (`/live/:code`,
// `/teacher/live/:code`) — a raw URL segment a caller can put ANYTHING in,
// including `..%2F..%2Fsomething`. Every function below that builds a
// fetch path from `code` validates it first, so a crafted link can never
// turn into a request against some other endpoint carrying the caller's
// bearer token (client-side path traversal / CSPT). Callers that read
// `code` from `useParams` should check `isValidLiveQuizCode` themselves
// too, so a malformed code never even reaches these functions — see
// StudentLiveQuizPlay.tsx / TeacherLiveQuizHost.tsx / TeacherLiveQuizHistory.tsx.
const GAME_CODE_RE = /^\d{6}$/;

export function isValidLiveQuizCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && GAME_CODE_RE.test(code);
}

function assertGameCode(code: string): void {
  if (!GAME_CODE_RE.test(code)) {
    throw new LiveQuizApiError('無效的課堂搶答代碼', 400);
  }
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    onApiUnauthorized(res);
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new LiveQuizApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Types (mirrors engine.build_state / get_game_results — see backend
// services/live_quiz/engine.py docstrings for the authoritative shape) ---

export type LiveQuizStatus = 'lobby' | 'question' | 'reveal' | 'ended';

export interface LiveQuizOption {
  key: string;
  text: string;
  /** #3621: present only for the handful of comprehension options whose
   *  real content is a picture (「下列哪一張圖…」). Same-origin relative
   *  path from the backend (`/assets/lesson/<uid>/<file>`) — resolved onto
   *  ASSET_BASE in OptionGrid, the single place host/player render options. */
  image?: string;
}

export interface LiveQuizRoundView {
  item_id: string | null;
  source_module: string;
  lesson_uid: string;
  lesson_title: string;
  stem: string;
  options?: LiveQuizOption[];
  seconds: number;
  reading_seconds: number;
  extra?: { target_index: number };
  correct_key?: string;
  /** issue #3631 P0 #2 — only present once revealed AND the question has
   *  explanation text (comprehension only, ~50/180 lessons). Absent, not
   *  empty string, when there is nothing to show. */
  explanation?: string;
}

export interface LiveQuizHostPlayer {
  player_id: number;
  display_name: string;
  total_score: number;
  online: boolean;
}

export interface LiveQuizYourPlayer {
  player_id: number;
  display_name: string;
  eligible: boolean;
  correct_count: number;
  previous_game_correct_count?: number | null;
  improved?: boolean | null;
  last_answer_correct?: boolean | null;
  last_answer_points?: number;
  /** issue #3631 P0 #4 — running total score. Present alongside
   *  last_answer_points (reveal/ended, non-practice-mode only). */
  total_score?: number;
  /** Present ONLY when this player is in the top 5 after this round. */
  rank?: number;
  /** Present ONLY when NOT in the top 5 — signed places moved by this
   *  round (positive = advanced toward rank 1, negative = retreated,
   *  0 = unchanged). Render as "前進/後退 N 名", never "第 N 名". */
  rank_delta?: number;
}

export interface LiveQuizLeaderboardEntry {
  player_id: number;
  display_name: string;
  total_score: number;
  rank: number;
}

export interface LiveQuizSettings {
  seconds: number;
  // issue #3631 P0 #1 — mutually exclusive: exactly one of the two is
  // present. `reading_seconds` is the legacy/manual-override shape (one
  // fixed value for every round); `reading_pace` is what the Setup page
  // now sends, and each round's own reading_seconds is computed
  // server-side from its stem length (see round.reading_seconds instead).
  reading_seconds?: number;
  reading_pace?: 'slow' | 'standard' | 'fast';
  question_count_mode: 'all' | number;
  shuffle: boolean;
  show_leaderboard_after_each: boolean;
  double_points_last: boolean;
  streak_bonus: boolean;
  practice_mode: boolean;
  source_modules: string[];
  question_count_fallback?: boolean;
}

export interface LiveQuizState {
  code: string;
  status: LiveQuizStatus;
  version: number;
  server_now: string;
  round_index: number;
  rounds_total: number;
  question_started_at: string | null;
  answer_open_at: string | null;
  reading_seconds: number;
  round: LiveQuizRoundView | null;
  answered_count: number | null;
  correct_count?: number;
  players_count: number;
  is_host: boolean;
  classroom_id: number | null;
  settings: LiveQuizSettings;
  ended_reason: string | null;
  ended_by_host: boolean;
  players?: LiveQuizHostPlayer[];
  online_count?: number;
  leaderboard?: LiveQuizLeaderboardEntry[];
  your_player?: LiveQuizYourPlayer;
  unchanged?: boolean;
}

export interface LiveQuizCreateRequest {
  lesson_uids: string[];
  source_modules?: string[];
  question_count_mode?: 'all' | number;
  seconds?: number;
  /** Manual override (advanced/back-compat) — when set, every round gets
   *  exactly this many reading seconds. The Setup page no longer sends
   *  this; it sends `reading_pace` instead. */
  reading_seconds?: number;
  /** 慢/標準/快 — ignored by the backend when reading_seconds is set. */
  reading_pace?: 'slow' | 'standard' | 'fast';
  classroom_id?: number | null;
  shuffle?: boolean;
  show_leaderboard_after_each?: boolean;
  practice_mode?: boolean;
}

export interface LiveQuizCreateResponse {
  code: string;
  game_id: number;
  status: LiveQuizStatus;
  rounds_total: number;
  settings: LiveQuizSettings;
  question_count_fallback: boolean;
  expires_at: string;
}

export interface LiveQuizGameSummary {
  code: string;
  status: LiveQuizStatus;
  classroom_id: number | null;
  created_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  rounds_total: number;
  players_count: number;
}

export interface LiveQuizRoundResult {
  round_index: number;
  item_id: string | null;
  source_module: string;
  lesson_title: string;
  stem: string;
  correct_key: string;
  answered: number;
  correct: number;
  accuracy: number | null;
}

export interface LiveQuizPlayerResult {
  player_id: number;
  display_name: string;
  total_score: number;
  rank: number | null;
  answers: { round_index: number; is_correct: boolean | null; points: number }[];
}

export interface LiveQuizResults {
  code: string;
  status: LiveQuizStatus;
  round_type: string;
  settings: LiveQuizSettings;
  created_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  classroom_id: number | null;
  rounds_total: number;
  players_count: number;
  ranking: LiveQuizLeaderboardEntry[];
  rounds: LiveQuizRoundResult[];
  players: LiveQuizPlayerResult[];
}

export interface LiveQuizInvite {
  code: string;
  status: LiveQuizStatus;
  classroom_id: number;
}

// --- API functions ---

export async function createLiveQuizGame(
  token: string,
  data: LiveQuizCreateRequest,
): Promise<LiveQuizCreateResponse> {
  const res = await fetch(`${API_BASE}/api/live-quiz/games`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<LiveQuizCreateResponse>(res);
}

export async function listMyLiveQuizGames(token: string): Promise<{ games: LiveQuizGameSummary[] }> {
  const res = await fetch(`${API_BASE}/api/live-quiz/games`, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function getLiveQuizInvite(token: string): Promise<{ invite: LiveQuizInvite | null }> {
  const res = await fetch(`${API_BASE}/api/live-quiz/invites`, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function joinLiveQuizGame(
  token: string,
  code: string,
): Promise<{ player_id: number; display_name: string; game_code: string }> {
  assertGameCode(code);
  const res = await fetch(`${API_BASE}/api/live-quiz/games/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function removeLiveQuizPlayer(token: string, code: string, playerId: number): Promise<void> {
  assertGameCode(code);
  const res = await fetch(
    `${API_BASE}/api/live-quiz/games/${encodeURIComponent(code)}/players/${encodeURIComponent(String(playerId))}`,
    { method: 'DELETE', headers: authHeaders(token) },
  );
  return handleResponse(res);
}

export async function getLiveQuizState(
  token: string,
  code: string,
  afterVersion?: number,
): Promise<LiveQuizState> {
  assertGameCode(code);
  const qs = afterVersion != null ? `?after_version=${encodeURIComponent(String(afterVersion))}` : '';
  const res = await fetch(`${API_BASE}/api/live-quiz/games/${encodeURIComponent(code)}/state${qs}`, {
    headers: authHeaders(token),
  });
  return handleResponse<LiveQuizState>(res);
}

export async function submitLiveQuizAnswer(
  token: string,
  code: string,
  submission: Record<string, unknown>,
): Promise<{ round_index: number; is_correct: boolean; points: number }> {
  assertGameCode(code);
  const res = await fetch(`${API_BASE}/api/live-quiz/games/${encodeURIComponent(code)}/answer`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ submission }),
  });
  return handleResponse(res);
}

interface HostControlBody {
  device_id?: string;
  confirm_takeover?: boolean;
}

async function hostControl(
  token: string,
  code: string,
  action: 'start' | 'reveal' | 'next' | 'end',
  body: HostControlBody = {},
): Promise<LiveQuizState> {
  assertGameCode(code);
  const res = await fetch(`${API_BASE}/api/live-quiz/games/${encodeURIComponent(code)}/${action}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse<LiveQuizState>(res);
}

export const startLiveQuizGame = (token: string, code: string, body?: HostControlBody) =>
  hostControl(token, code, 'start', body);
export const revealLiveQuizRound = (token: string, code: string, body?: HostControlBody) =>
  hostControl(token, code, 'reveal', body);
export const nextLiveQuizRound = (token: string, code: string, body?: HostControlBody) =>
  hostControl(token, code, 'next', body);
export const endLiveQuizGame = (token: string, code: string, body?: HostControlBody) =>
  hostControl(token, code, 'end', body);

export async function getLiveQuizResults(token: string, code: string): Promise<LiveQuizResults> {
  assertGameCode(code);
  const res = await fetch(`${API_BASE}/api/live-quiz/games/${encodeURIComponent(code)}/results`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

/** A per-browser-tab id so the backend can tell "same host, different poll
 * call" from "a second device took over" (UI/UX review #4). Not persisted
 * across reloads on purpose -- a refreshed host tab is still the same
 * person at the keyboard; a genuinely different device is the case this
 * guards against. */
let cachedDeviceId: string | null = null;
export function getHostDeviceId(): string {
  if (!cachedDeviceId) {
    cachedDeviceId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return cachedDeviceId;
}

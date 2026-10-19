/**
 * 五人對抗賽 (team_arena) API client — issue #3632,
 * docs/prd/2026-10-18-team-arena-prd.md §10. Follows the same pattern as
 * pkApi.ts/liveQuizApi.ts (this repo's closest sibling features).
 */
import { onApiUnauthorized } from './sessionGuard';
import { API_BASE } from './apiConfig';

export class TeamArenaApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'TeamArenaApiError';
    this.status = status;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// Same student-facing-message-sanitizing reasoning as pkApi.ts (#3610): a
// non-Chinese server detail (stray 500, FastAPI 422 array) must never
// reach a child's screen as-is.
const HAS_CJK = /[一-鿿]/;
const TEAM_ARENA_GENERIC_ERROR = '發生錯誤，請稍後再試一次';

function studentFacingMessage(detail: unknown): string {
  return typeof detail === 'string' && HAS_CJK.test(detail) ? detail : TEAM_ARENA_GENERIC_ERROR;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    onApiUnauthorized(res);
    let detail: unknown;
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.message;
    } catch {
      // ignore JSON parse errors
    }
    throw new TeamArenaApiError(studentFacingMessage(detail), res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// --- Types (mirrors services/team_arena/engine.py response shapes) ---

export type TeamArenaScopeType = 'lesson' | 'grade_pool';
export type TeamArenaReadingSpeed = 'slow' | 'standard' | 'fast';
export type TeamArenaSessionStatus = 'lobby' | 'playing' | 'paused' | 'ended';
export type TeamArenaLane =
  | 'zhuyin'
  | 'vocab_definitions'
  | 'vocab_application'
  | 'comprehension'
  | 'support';

export const TEAM_ARENA_PRIMARY_LANES: TeamArenaLane[] = [
  'zhuyin',
  'vocab_definitions',
  'vocab_application',
  'comprehension',
];

export const TEAM_ARENA_LANE_LABELS: Record<TeamArenaLane, string> = {
  zhuyin: '注音路',
  vocab_definitions: '詞義路',
  vocab_application: '應用路',
  comprehension: '閱讀路',
  support: '支援位',
};

export interface TeamArenaCreateSessionRequest {
  classroom_id: number;
  scope_type: TeamArenaScopeType;
  scope_ref: string;
  turns_per_player?: 1 | 2 | 3;
  answer_seconds?: 20 | 30 | 45;
  reading_speed?: TeamArenaReadingSpeed;
  story_pack_key?: string | null;
}

export interface TeamArenaCreateSessionResponse {
  code: string;
  status: TeamArenaSessionStatus;
}

export type TeamArenaTeamsRequest =
  | { action: 'auto' }
  | { action: 'swap'; student_a_id: number; student_b_id: number }
  | { action: 'override'; student_id: number; grade_pool_override: boolean };

export interface TeamArenaOption {
  key: string;
  text: string;
  image?: string;
}

/** `options`/`correct_key` are absent server-side until the reading phase
 * ends / the round is revealed — never assume they are present. */
export interface TeamArenaRoundPayload {
  item_id?: string | null;
  source_module?: string;
  lesson_uid?: string;
  lesson_title?: string;
  stem: string;
  options?: TeamArenaOption[];
  correct_key?: string;
  seconds?: number;
  extra?: { target_index: number } | null;
}

export interface TeamArenaCurrentRound {
  turn_no: number;
  lane: TeamArenaLane;
  active_student_id: number;
  payload: TeamArenaRoundPayload;
  reading_seconds: number;
  answer_seconds: number;
  revealed: boolean;
}

export interface TeamArenaTeamSummary {
  towers_down: Record<string, number>;
  base_hits: number;
  score: number;
  match_status: 'active' | 'ended';
  winner: 'a' | 'b' | 'draw' | null;
  current_round?: TeamArenaCurrentRound;
}

export interface TeamArenaOwnMatch extends TeamArenaTeamSummary {
  my_lane: TeamArenaLane;
  am_i_active: boolean;
}

export interface TeamArenaStoryView {
  key: string | null;
  team_labels: [string, string];
  intro: string;
  background_art: Record<string, unknown> | null;
  energy_bar_label: string;
  result_copy: { win: string; lose: string; draw: string };
}

export interface TeamArenaUnchangedState {
  state_version: number;
  unchanged: true;
}

interface TeamArenaStateBase {
  code: string;
  status: TeamArenaSessionStatus;
  turn_no: number;
  state_version: number;
  story: TeamArenaStoryView;
  unchanged?: false;
}

export interface TeamArenaTeacherState extends TeamArenaStateBase {
  matches: Record<string, TeamArenaTeamSummary>;
}

export interface TeamArenaStudentState extends TeamArenaStateBase {
  own_match: TeamArenaOwnMatch | null;
}

export type TeamArenaState = TeamArenaTeacherState | TeamArenaStudentState | TeamArenaUnchangedState;

export function isUnchangedState(state: TeamArenaState): state is TeamArenaUnchangedState {
  return (state as TeamArenaUnchangedState).unchanged === true;
}

export function isTeacherState(state: TeamArenaState): state is TeamArenaTeacherState {
  return !isUnchangedState(state) && 'matches' in state;
}

export interface TeamArenaAnswerResult {
  role: 'active' | 'assist';
  turn_no: number;
}

export interface TeamArenaResultMe {
  lane: TeamArenaLane;
  turns_played: number;
  towers_knocked: number;
  assists: number;
}

export interface TeamArenaResult {
  matches: Record<string, TeamArenaTeamSummary>;
  me: TeamArenaResultMe | null;
}

// --- API functions ---

export async function createTeamArenaSession(
  token: string,
  body: TeamArenaCreateSessionRequest,
): Promise<TeamArenaCreateSessionResponse> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function joinTeamArenaSession(
  token: string,
  code: string,
): Promise<{ code: string; status: TeamArenaSessionStatus }> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function assignTeamArenaTeams(
  token: string,
  code: string,
  body: TeamArenaTeamsRequest,
): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/teams`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function claimTeamArenaLane(
  token: string,
  code: string,
  lane: TeamArenaLane,
): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/lane`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ lane }),
  });
  return handleResponse(res);
}

export async function controlTeamArena(
  token: string,
  code: string,
  action: 'start' | 'pause' | 'resume' | 'next' | 'end',
): Promise<{ status: TeamArenaSessionStatus; turn_no: number }> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/control`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ action }),
  });
  return handleResponse(res);
}

export async function getTeamArenaState(
  token: string,
  code: string,
  afterVersion?: number,
): Promise<TeamArenaState> {
  const qs = afterVersion != null ? `?after_version=${encodeURIComponent(String(afterVersion))}` : '';
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/state${qs}`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function submitTeamArenaAnswer(
  token: string,
  code: string,
  choiceKey: string,
): Promise<TeamArenaAnswerResult> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/answer`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ choice_key: choiceKey }),
  });
  return handleResponse(res);
}

export async function getTeamArenaResult(token: string, code: string): Promise<TeamArenaResult> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/result`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

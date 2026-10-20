/**
 * 多人對抗賽 (team_arena) API client — v2, issue #3632,
 * docs/prd/2026-10-18-team-arena-prd.md §0 "⭐ v2 改版" §10. Mirrors
 * app.services.team_arena.engine's response shapes exactly (role-aware
 * dicts, not a parallel type hierarchy the backend has to stay in sync
 * with by hand).
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

// --- Types ---

export type TeamArenaSessionStatus = 'lobby' | 'playing' | 'paused' | 'ended';
export type TeamArenaSide = 'a' | 'b';
export type TeamArenaWeapon = 'call_teammate' | 'eliminate' | 'hint';

export const TEAM_ARENA_WEAPON_LABELS: Record<TeamArenaWeapon, string> = {
  call_teammate: '呼叫隊友',
  eliminate: '刪減法',
  hint: '看提示',
};

export interface TeamArenaCreateSessionRequest {
  team_size?: 2 | 3 | 4 | 5;
  turns_per_player?: 1 | 2 | 3;
  answer_seconds?: 20 | 30 | 45;
  story_pack_key?: string | null;
  side?: TeamArenaSide;
}

export interface TeamArenaCreateSessionResponse {
  code: string;
  status: TeamArenaSessionStatus;
}

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

/** The viewer's OWN side's current round — shape differs by role:
 * - active player: full question + any weapon effects they triggered.
 * - teammate (not summoned): `{turn_no, called_for_help: false}` only.
 * - teammate (summoned via 呼叫隊友): stem + full options + suggestions
 *   are NOT included here (those only ever appear on the ACTIVE player's
 *   own view — PRD rule H). */
export interface TeamArenaCurrentRound {
  turn_no: number;
  called_for_help?: boolean;
  stem?: string;
  extra?: { target_index: number } | null;
  options?: TeamArenaOption[] | null;
  reading_seconds?: number;
  answer_seconds?: number;
  revealed?: boolean;
  correct_key?: string;
  hint_text?: string | null;
  call_teammate_active?: boolean;
  suggestions?: { student_id: number; display_name: string; choice_key: string }[];
}

export interface TeamArenaSidePublicMember {
  student_id: number;
  display_name: string;
}

export interface TeamArenaSidePublic {
  seated: number;
  team_size: number;
  towers_destroyed: number;
  current_hp: number;
  base_destroyed: boolean;
  match_status: 'active' | 'ended';
  winner: TeamArenaSide | 'draw' | null;
  members: TeamArenaSidePublicMember[];
}

export interface TeamArenaOwnMatch {
  my_side: TeamArenaSide;
  match_status: 'active' | 'ended';
  winner: TeamArenaSide | 'draw' | null;
  am_i_active: boolean;
  current_round: TeamArenaCurrentRound | null;
  weapons_used: Record<TeamArenaWeapon, boolean>;
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
  team_size: number;
  is_host: boolean;
  // PRD v2 rule P: 決戰時刻 — true for every turn in the final lap.
  showdown: boolean;
  sides: Record<TeamArenaSide, TeamArenaSidePublic>;
  own_match: TeamArenaOwnMatch | null;
  unchanged?: false;
}

export type TeamArenaState = TeamArenaStateBase | TeamArenaUnchangedState;

export function isUnchangedState(state: TeamArenaState): state is TeamArenaUnchangedState {
  return (state as TeamArenaUnchangedState).unchanged === true;
}

export interface TeamArenaAnswerResult {
  turn_no: number;
}

export interface TeamArenaWeaponResult {
  status: string;
  weapon: TeamArenaWeapon;
  options?: TeamArenaOption[];
  hint_text?: string;
}

export interface TeamArenaResultPlayer {
  student_id: number;
  display_name: string;
  highlight: string;
}

export interface TeamArenaResultSide {
  towers_destroyed: number;
  base_destroyed: boolean;
  match_status: 'active' | 'ended';
  winner: TeamArenaSide | 'draw' | null;
}

/** PRD §0 v2 rule Q: NO individual ranking or numeric score anywhere in
 * this shape — only a team result + one highlight sentence per player. */
export interface TeamArenaResult {
  sides: Record<TeamArenaSide, TeamArenaResultSide>;
  players: Record<TeamArenaSide, TeamArenaResultPlayer[]>;
  me: { my_side: TeamArenaSide; highlight: string } | null;
}

/** Win/lose/draw relative to the student's OWN side. */
export function teamArenaMyOutcome(ownMatch: Pick<TeamArenaOwnMatch, 'winner' | 'my_side'>): 'win' | 'lose' | 'draw' | null {
  if (!ownMatch.winner) return null;
  if (ownMatch.winner === 'draw') return 'draw';
  return ownMatch.winner === ownMatch.my_side ? 'win' : 'lose';
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
  side: TeamArenaSide,
): Promise<{ code: string; status: TeamArenaSessionStatus }> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/join`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ side }),
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

export async function submitTeamArenaWeapon(
  token: string,
  code: string,
  weapon: TeamArenaWeapon,
): Promise<TeamArenaWeaponResult> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/weapons`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ weapon }),
  });
  return handleResponse(res);
}

export async function submitTeamArenaSuggestion(
  token: string,
  code: string,
  choiceKey: string,
): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/team-arena/sessions/${encodeURIComponent(code)}/suggest`, {
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

import { API_BASE } from './apiConfig';
import { onApiUnauthorized } from './sessionGuard';

export class EscapeRoomApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'EscapeRoomApiError';
    this.status = status;
  }
}

const HAS_CJK = /[一-鿿]/;
const GENERIC_ERROR = '發生錯誤，請稍後再試一次';

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

function studentFacingMessage(detail: unknown): string {
  return typeof detail === 'string' && HAS_CJK.test(detail) ? detail : GENERIC_ERROR;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    onApiUnauthorized(res);
    let detail: unknown;
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.message;
    } catch {
      // A non-JSON error must use the same student-safe fallback.
    }
    throw new EscapeRoomApiError(studentFacingMessage(detail), res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type EscapeRoomScopeType = 'lesson' | 'grade_pool';
export type EscapeRoomAbilityKey = 'hint' | 'extra_time' | 'shield';
export type EscapeRoomRunStatus = 'in_progress' | 'escaped' | 'not_this_time' | 'abandoned';

export interface EscapeRoomOption {
  key: string;
  text: string;
}

export interface SafeQuestion {
  chamber_index: number | null;
  stem: string;
  options: EscapeRoomOption[];
  seconds: number;
  extra_time_ms: number;
  /** #3754: zhuyin 題的 `{ target_index: N }` — 標出 stem 裡在問哪一個字
   *  （同一個字可能在句子裡出現不只一次）。跟 pkApi.ts / teamArenaApi.ts /
   *  liveQuizApi.ts 的 `extra` 欄位同一個形狀。 */
  extra?: { target_index: number } | null;
}

export interface EscapeRoomTeammate {
  slug: string;
  frozen: boolean;
}

export interface EscapeRoomRunState {
  run_id: number;
  status: EscapeRoomRunStatus;
  mist_distance: number;
  unlocked_chambers: number;
  teammates: EscapeRoomTeammate[];
  abilities_used: EscapeRoomAbilityKey[];
  current_chamber: SafeQuestion | null;
  rescue_question: SafeQuestion | null;
  gate_question: SafeQuestion | null;
  story_intro: string;
  mist_message: string;
}

export interface EscapeRoomStartResponse {
  run_id: number;
}

export interface EscapeRoomResult {
  run_id: number;
  result: 'escaped' | 'not_this_time' | 'abandoned';
  message: string;
  unlocked_skins: EscapeRoomSkin[];
}

export interface EscapeRoomSkin {
  story_pack_key: string;
  chapter_key: string;
  name?: string;
  art?: string | null;
}

export interface EscapeRoomUnlocksResponse {
  unlocks: EscapeRoomSkin[];
}

export async function startEscapeRoomRun(
  token: string,
  body: { scope_type: EscapeRoomScopeType; scope_ref: string },
): Promise<EscapeRoomStartResponse> {
  const res = await fetch(`${API_BASE}/api/escape-room/runs`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function getEscapeRoomRunState(token: string, runId: number): Promise<EscapeRoomRunState> {
  const res = await fetch(`${API_BASE}/api/escape-room/runs/${encodeURIComponent(String(runId))}/state`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function submitEscapeRoomAnswer(
  token: string,
  runId: number,
  body: { chamber_index: number; choice_key: string },
): Promise<EscapeRoomRunState> {
  const res = await fetch(`${API_BASE}/api/escape-room/runs/${encodeURIComponent(String(runId))}/answer`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function submitEscapeRoomGateAnswer(
  token: string,
  runId: number,
  body: { choice_key: string },
): Promise<EscapeRoomRunState> {
  const res = await fetch(`${API_BASE}/api/escape-room/runs/${encodeURIComponent(String(runId))}/gate-answer`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function submitEscapeRoomRescue(
  token: string,
  runId: number,
  body: { choice_key: string },
): Promise<EscapeRoomRunState> {
  const res = await fetch(`${API_BASE}/api/escape-room/runs/${encodeURIComponent(String(runId))}/rescue`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function activateEscapeRoomAbility(
  token: string,
  runId: number,
  body: { ability_key: EscapeRoomAbilityKey },
): Promise<EscapeRoomRunState> {
  const res = await fetch(`${API_BASE}/api/escape-room/runs/${encodeURIComponent(String(runId))}/use-ability`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function getEscapeRoomResult(token: string, runId: number): Promise<EscapeRoomResult> {
  const res = await fetch(`${API_BASE}/api/escape-room/runs/${encodeURIComponent(String(runId))}/result`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function getEscapeRoomUnlocks(token: string): Promise<EscapeRoomUnlocksResponse> {
  const res = await fetch(`${API_BASE}/api/escape-room/unlocks`, { headers: authHeaders(token) });
  return handleResponse(res);
}

/** #3756: "我的挑戰紀錄" — one row per past run, most-recent-first. */
export interface EscapeRoomHistoryEntry {
  run_id: number;
  scope_type: EscapeRoomScopeType;
  scope_ref: string;
  result: EscapeRoomRunStatus;
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
}

export interface EscapeRoomHistoryResponse {
  runs: EscapeRoomHistoryEntry[];
}

export async function getEscapeRoomHistory(token: string): Promise<EscapeRoomHistoryResponse> {
  const res = await fetch(`${API_BASE}/api/escape-room/runs/mine`, { headers: authHeaders(token) });
  return handleResponse(res);
}

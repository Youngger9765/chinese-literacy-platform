/**
 * toolboxApi.ts — Practice Toolbox session API (#1463 / #1460 Phase 2).
 *
 * Each tool in the practice toolbox (`/tools` page) writes single-shot
 * practice rows to its own dedicated table (one of 10 `toolbox_*_sessions`).
 * Rows are independent — there is no progression / next-step concept.
 *
 * Tool-specific result shapes live inside the `result` JSONB blob; the API
 * surface is generic so adding a new tool only requires registering it on
 * the backend (TOOL_MODEL_MAP) and updating ToolId here.
 *
 * Self-practice / assignment flows continue to use `learningApi.ts` and
 * write to `learning_sessions` — this file is toolbox-only.
 */

import { SessionExpiredError } from './api';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// Order matches frontend/src/components/tools/ToolPicker.tsx TOOL_OPTIONS
// and backend/app/routes/learning/toolbox.py TOOL_MODEL_MAP.
export type ToolId =
  | 'tutor'
  | 'full-reading'
  | 'listening'
  | 'vocab'
  | 'sentence-practice'
  | 'vocab-definition'
  | 'vocab-application'
  | 'comprehension'
  | 'vocab-word-search'
  | 'knowledge-station';

export interface ToolboxSession {
  id: number;
  student_id: number;
  text_id: number | null;
  result: Record<string, unknown>;
  score: number | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
  tool_id: ToolId;
}

interface CreatePayload {
  text_id?: number | null;
  result?: Record<string, unknown>;
}

interface UpdatePayload {
  result?: Record<string, unknown>;
  score?: number | null;
  duration_ms?: number | null;
  completed_at?: string | null;
}

async function authedFetch(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) throw new SessionExpiredError('Toolbox API session expired');
  return res;
}

/**
 * Open a new toolbox session row. Returns the row's id so the caller can
 * PATCH it on completion. `result` may be empty at this point.
 */
export async function createToolboxSession(
  toolId: ToolId,
  token: string,
  payload: CreatePayload = {},
): Promise<ToolboxSession> {
  const res = await authedFetch(`/api/toolbox/${toolId}/sessions`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createToolboxSession(${toolId}) failed: ${res.status}`);
  return res.json();
}

/**
 * Patch result / score / duration / completion timestamp. Setting
 * `completed_at` marks the practice as finished. The backend rejects
 * sessions belonging to a different student.
 */
export async function updateToolboxSession(
  toolId: ToolId,
  sessionId: number,
  token: string,
  payload: UpdatePayload,
): Promise<ToolboxSession> {
  const res = await authedFetch(
    `/api/toolbox/${toolId}/sessions/${sessionId}`,
    token,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
  if (!res.ok) throw new Error(`updateToolboxSession(${toolId}, ${sessionId}) failed: ${res.status}`);
  return res.json();
}

/**
 * Convenience wrapper — write a complete practice in a single call:
 * POST then PATCH with completed_at = now. The toolbox-mode finishHandler
 * usually wants this rather than two separate round-trips.
 */
export async function recordToolboxCompletion(
  toolId: ToolId,
  token: string,
  payload: CreatePayload & { score?: number | null; duration_ms?: number | null },
): Promise<ToolboxSession> {
  const created = await createToolboxSession(toolId, token, {
    text_id: payload.text_id,
    result: payload.result ?? {},
  });
  return updateToolboxSession(toolId, created.id, token, {
    score: payload.score ?? null,
    duration_ms: payload.duration_ms ?? null,
    completed_at: new Date().toISOString(),
  });
}

/** List the current student's sessions for one tool, newest first. */
export async function listToolboxSessions(
  toolId: ToolId,
  token: string,
  limit = 50,
): Promise<ToolboxSession[]> {
  const res = await authedFetch(
    `/api/toolbox/${toolId}/sessions?limit=${limit}`,
    token,
  );
  if (!res.ok) throw new Error(`listToolboxSessions(${toolId}) failed: ${res.status}`);
  return res.json();
}

/**
 * Aggregated history across all 10 toolbox tables, newest first. Used by
 * the 學習紀錄 page to render toolbox sessions inline with self-practice
 * ones, tagged via the `tool_id` field.
 */
export async function listAllToolboxSessions(
  token: string,
  limit = 100,
): Promise<ToolboxSession[]> {
  const res = await authedFetch(`/api/toolbox/sessions/all?limit=${limit}`, token);
  if (!res.ok) throw new Error(`listAllToolboxSessions failed: ${res.status}`);
  return res.json();
}

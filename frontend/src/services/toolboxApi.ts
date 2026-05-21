/**
 * toolboxApi.ts — Practice Toolbox session API (#1463 / #1460 Phase 2).
 *
 * Each tool in the practice toolbox (`/tools` page) writes single-shot
 * practice rows to its own dedicated table (one of 10 `toolbox_*_sessions`).
 * Rows are independent — there is no progression / next-step concept.
 *
 * #1473: Recording a completion is now a single atomic POST. The backend
 * creates the row already in completed state, eliminating orphan rows from
 * the previous two-step POST-then-PATCH pattern.
 *
 * Tool-specific result shapes live inside the `result` JSONB blob; the API
 * surface is generic so adding a new tool only requires registering it on
 * the backend (TOOL_MODEL_MAP) and updating ToolId here.
 *
 * Self-practice / assignment flows continue to use `learningApi.ts` and
 * write to `learning_sessions` — this file is toolbox-only.
 */

import { API_BASE } from './apiConfig';
import { handle401Response } from './apiUnauthorized';

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

/** Full payload for a completed toolbox practice (#1473). */
interface CreatePayload {
  text_id?: number | null;
  result?: Record<string, unknown>;
  score?: number | null;
  duration_ms?: number | null;
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
  if (res.status === 401) await handle401Response(res, 'Toolbox API session expired');
  return res;
}

/**
 * Record a completed toolbox practice in a single atomic request (#1473).
 *
 * The backend creates the row already in completed state (completed_at = NOW()).
 * All practice data — result blob, score, duration — is submitted together
 * to avoid orphan rows from the previous two-step POST-then-PATCH pattern.
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
 * Convenience alias — record a complete practice in a single call.
 * Replaces the previous POST-then-PATCH two-step pattern (#1473).
 * Kept as a named export so callers using this name require no changes.
 */
export async function recordToolboxCompletion(
  toolId: ToolId,
  token: string,
  payload: CreatePayload,
): Promise<ToolboxSession> {
  return createToolboxSession(toolId, token, payload);
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

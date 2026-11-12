import { API_BASE } from './apiConfig';
import type { LeagueTheme, LeagueThemeSummary } from '../types/leagueTheme';

/**
 * Admin Story Pack Studio API — system_admin-only CRUD + live validation
 * for the world/story content a game mode binds to (today: 跨班賽季's
 * storyline/chest/badge content). Generalized 2026-10-16 from
 * adminLeagueThemeApi.ts per Young's direction (mode-agnostic naming).
 *
 * Reuses the `LeagueTheme`/`LeagueThemeSummary` TS shapes from
 * types/leagueTheme.ts on purpose — the wire format is unchanged (same
 * fields), so there is no value in duplicating the type under a new name;
 * only the backend's storage/admin-surface naming changed.
 * Follows the same pattern as roleApi.ts / storyStructureLabApi.ts.
 */

/** Issue 3615: `field` is the Chinese field label, `msg` the Chinese
 * description, `loc` the JSON path. */
export interface StoryPackFieldError {
  loc: string;
  field?: string;
  msg: string;
}

export interface ValidatePackResult {
  valid: boolean;
  errors: Array<StoryPackFieldError>;
}

export class AdminStoryPackApiError extends Error {
  status: number;
  errors?: Array<StoryPackFieldError>;
  constructor(message: string, status: number, errors?: Array<StoryPackFieldError>) {
    super(message);
    this.name = 'AdminStoryPackApiError';
    this.status = status;
    this.errors = errors;
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
    // Issue 3615: everything shown to the admin is Chinese. A non-string
    // detail is FastAPI's own English request-validation list.
    let message = `請求失敗（${res.status}）`;
    try {
      const body = await res.json();
      const detail = body.detail ?? body.message;
      if (typeof detail === 'string') message = detail;
    } catch {
      // ignore JSON parse errors
    }
    throw new AdminStoryPackApiError(message, res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export async function fetchPackList(token: string): Promise<LeagueThemeSummary[]> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueThemeSummary[]>(res);
}

export async function fetchPack(token: string, key: string): Promise<LeagueTheme> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueTheme>(res);
}

export async function fetchActivePack(token: string): Promise<LeagueTheme> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs/active`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<LeagueTheme>(res);
}

export async function setActivePack(token: string, key: string): Promise<LeagueTheme> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs/active`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ key }),
  });
  return handleResponse<LeagueTheme>(res);
}

/** Live validation — no write. Always resolves (never throws on invalid
 * payload; `valid: false` + `errors` is the normal "bad draft" response). */
export async function validatePackPayload(
  token: string,
  payload: Record<string, unknown>,
): Promise<ValidatePackResult> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs/validate`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ payload }),
  });
  return handleResponse<ValidatePackResult>(res);
}

export async function upsertPack(
  token: string,
  key: string,
  payload: Record<string, unknown>,
): Promise<LeagueTheme> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ payload }),
  });
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    throw new AdminStoryPackApiError(
      typeof body.detail === 'string' ? body.detail : '劇情包內容驗證失敗',
      422,
      Array.isArray(body.errors) ? body.errors : undefined,
    );
  }
  return handleResponse<LeagueTheme>(res);
}

export async function deletePack(token: string, key: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<void>(res);
}

export async function assignSeasonPack(
  token: string,
  seasonId: number,
  key: string | null,
): Promise<{ season_id: number; pack: LeagueTheme | null }> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs/seasons/${seasonId}`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ key }),
  });
  return handleResponse<{ season_id: number; pack: LeagueTheme | null }>(res);
}

export async function fetchSeasonPack(
  token: string,
  seasonId: number,
): Promise<{ season_id: number; override_key: string | null; effective_pack: LeagueTheme }> {
  const res = await fetch(`${API_BASE}/api/admin/story-packs/seasons/${seasonId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<{ season_id: number; override_key: string | null; effective_pack: LeagueTheme }>(res);
}

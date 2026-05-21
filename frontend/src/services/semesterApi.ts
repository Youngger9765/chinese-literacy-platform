import { API_BASE } from './apiConfig';
/**
 * Semester API service — school semester management.
 * Follows the same pattern as schoolApi.ts.
 */


// ── Types ────────────────────────────────────────────────────────────────────

export interface SemesterResponse {
  id: number;
  school_id: number | null;
  name: string;
  start_date: string;  // ISO date "YYYY-MM-DD"
  end_date: string;
  grace_days: number;
  is_active: boolean;
  expires_at_date: string;  // ISO date
  created_at: string;
  updated_at: string;
}

export interface SemesterCreateRequest {
  name: string;
  start_date: string;
  end_date: string;
  grace_days?: number;
  is_active?: boolean;
}

export interface SemesterUpdateRequest {
  name?: string;
  start_date?: string;
  end_date?: string;
  grace_days?: number;
}

// ── Error class ───────────────────────────────────────────────────────────────

export class SemesterApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SemesterApiError';
    this.status = status;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    throw new SemesterApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function listSemesters(
  token: string,
  schoolId: number,
): Promise<SemesterResponse[]> {
  const res = await fetch(`${API_BASE}/api/schools/${schoolId}/semesters`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<SemesterResponse[]>(res);
}

export async function getActiveSemester(
  token: string,
  schoolId: number,
): Promise<SemesterResponse | null> {
  const res = await fetch(`${API_BASE}/api/schools/${schoolId}/semesters/active`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<SemesterResponse | null>(res);
}

export async function createSemester(
  token: string,
  schoolId: number,
  data: SemesterCreateRequest,
): Promise<SemesterResponse> {
  const res = await fetch(`${API_BASE}/api/schools/${schoolId}/semesters`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<SemesterResponse>(res);
}

export async function updateSemester(
  token: string,
  schoolId: number,
  semesterId: number,
  data: SemesterUpdateRequest,
): Promise<SemesterResponse> {
  const res = await fetch(`${API_BASE}/api/schools/${schoolId}/semesters/${semesterId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<SemesterResponse>(res);
}

export async function activateSemester(
  token: string,
  schoolId: number,
  semesterId: number,
): Promise<SemesterResponse> {
  const res = await fetch(
    `${API_BASE}/api/schools/${schoolId}/semesters/${semesterId}/activate`,
    {
      method: 'POST',
      headers: authHeaders(token),
    },
  );
  return handleResponse<SemesterResponse>(res);
}

import { API_BASE } from './apiConfig';
/**
 * School API service -- admin school management.
 * Follows the same pattern as classroomApi.ts.
 */


// --- Response types ---

export interface SchoolResponse {
  id: number;
  name: string;
  display_name: string | null;
  organization_id: string | null;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface SchoolListResponse {
  items: SchoolResponse[];
  total: number;
}

export interface SchoolClassroomResponse {
  id: number;
  name: string;
  grade: number | null;
  is_active: boolean;
  teacher_id: number;
  teacher_name: string;
  student_count: number;
  created_at: string;
}

// --- Error class ---

export class SchoolApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SchoolApiError';
    this.status = status;
  }
}

// --- Helpers ---

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
    throw new SchoolApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// --- API functions ---

export async function createSchool(
  token: string,
  data: { name: string; organization_id?: string; address?: string; phone?: string },
): Promise<SchoolResponse> {
  const res = await fetch(`${API_BASE}/api/schools`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<SchoolResponse>(res);
}

export async function listSchools(
  token: string,
  params?: { limit?: number; offset?: number },
): Promise<SchoolListResponse> {
  const query = new URLSearchParams();
  if (params?.limit != null) query.set('limit', String(params.limit));
  if (params?.offset != null) query.set('offset', String(params.offset));

  const qs = query.toString();
  const url = `${API_BASE}/api/schools${qs ? `?${qs}` : ''}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<SchoolListResponse>(res);
}

export async function getSchool(
  token: string,
  schoolId: number,
): Promise<SchoolResponse> {
  const res = await fetch(`${API_BASE}/api/schools/${schoolId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<SchoolResponse>(res);
}

export async function updateSchool(
  token: string,
  schoolId: number,
  data: { name?: string; display_name?: string; address?: string; phone?: string; is_active?: boolean },
): Promise<SchoolResponse> {
  const res = await fetch(`${API_BASE}/api/schools/${schoolId}`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<SchoolResponse>(res);
}

export async function listSchoolClassrooms(
  token: string,
  schoolId: number,
): Promise<SchoolClassroomResponse[]> {
  const res = await fetch(`${API_BASE}/api/schools/${schoolId}/classrooms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<SchoolClassroomResponse[]>(res);
}

// --- School members ---

export interface SchoolMemberResponse {
  user_id: number;
  name: string;
  email: string;
  role_name: string;
  role_display_name: string;
}

export async function listSchoolMembers(
  token: string,
  schoolId: number,
): Promise<SchoolMemberResponse[]> {
  const res = await fetch(`${API_BASE}/api/schools/${schoolId}/members`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<SchoolMemberResponse[]>(res);
}

// --- Regenerate join code ---

export async function regenerateSchoolCode(
  token: string,
  schoolId: number,
): Promise<{ join_code: string }> {
  const res = await fetch(
    `${API_BASE}/api/schools/${schoolId}/regenerate-code`,
    {
      method: 'POST',
      headers: authHeaders(token),
    },
  );
  return handleResponse<{ join_code: string }>(res);
}

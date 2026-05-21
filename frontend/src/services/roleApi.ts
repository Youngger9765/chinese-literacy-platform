import { API_BASE } from './apiConfig';
/**
 * Role API service -- admin role management.
 * Follows the same pattern as classroomApi.ts.
 */


// --- Response types ---

export interface RoleResponse {
  id: number;
  name: string;
  display_name: string;
  scope_level: string;
}

export interface UserRoleDetailResponse {
  id: number;
  user_id: number;
  role_id: number;
  role_name: string;
  role_display_name: string;
  scope_type: string;
  scope_id: string | null;
  is_active: boolean;
  created_at: string;
}

// --- Error class ---

export class RoleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RoleApiError';
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
    throw new RoleApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// --- API functions ---

export async function listRoles(
  token: string,
): Promise<RoleResponse[]> {
  const res = await fetch(`${API_BASE}/api/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<RoleResponse[]>(res);
}

export async function assignRole(
  token: string,
  data: { user_id: number; role_name: string; scope_type: string; scope_id?: string },
): Promise<UserRoleDetailResponse> {
  const res = await fetch(`${API_BASE}/api/roles/assign`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse<UserRoleDetailResponse>(res);
}

export async function revokeRole(
  token: string,
  assignmentId: number,
): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/api/roles/assignments/${assignmentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<{ message: string }>(res);
}

export async function getUserRoles(
  token: string,
  userId: number,
): Promise<UserRoleDetailResponse[]> {
  const res = await fetch(`${API_BASE}/api/users/${userId}/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<UserRoleDetailResponse[]>(res);
}

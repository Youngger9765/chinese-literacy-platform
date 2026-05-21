import { API_BASE } from './apiConfig';
/**
 * User API service -- admin user management.
 * Follows the same pattern as roleApi.ts / organizationApi.ts.
 */


// --- Response types ---

export interface UserListItem {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  created_at: string;
  roles: { role_name: string; scope_type: string; scope_id: string | null }[];
}

export interface UserListResponse {
  items: UserListItem[];
  total: number;
}

// --- Error class ---

export class UserApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'UserApiError';
    this.status = status;
  }
}

// --- Helpers ---

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new UserApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

// --- API functions ---

export async function listUsers(
  token: string,
  params?: { limit?: number; offset?: number; search?: string },
): Promise<UserListResponse> {
  const query = new URLSearchParams();
  if (params?.limit != null) query.set('limit', String(params.limit));
  if (params?.offset != null) query.set('offset', String(params.offset));
  if (params?.search) query.set('search', params.search);
  const qs = query.toString();
  const res = await fetch(`${API_BASE}/api/users${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<UserListResponse>(res);
}

export async function getUser(
  token: string,
  userId: number,
): Promise<UserListItem> {
  const res = await fetch(`${API_BASE}/api/users/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<UserListItem>(res);
}

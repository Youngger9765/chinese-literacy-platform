/**
 * Auth API service — login, register, user info, password change.
 * Uses the same VITE_API_URL as api.ts.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface UserRole {
  role_name: string;
  role_display_name: string;
  scope_type: string;
  scope_id: string | null;
}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  roles: UserRole[];
  terms_accepted: boolean;
  terms_accepted_at: string | null;
  terms_version: string | null;
}

/** Check if user has a specific role */
export function hasRole(user: AuthUser | null, ...roleNames: string[]): boolean {
  if (!user) return false;
  return user.roles.some((r) => roleNames.includes(r.role_name));
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  must_change_password?: boolean;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

async function handleAuthResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore JSON parse errors
    }
    throw new AuthError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export async function login(
  email: string,
  password: string,
): Promise<AuthTokenResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return handleAuthResponse<AuthTokenResponse>(res);
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<AuthTokenResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return handleAuthResponse<AuthTokenResponse>(res);
}

export async function getMe(token: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleAuthResponse<AuthUser>(res);
}

export async function acceptTerms(token: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/accept-terms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleAuthResponse<AuthUser>(res);
}

export async function changePassword(
  oldPassword: string,
  newPassword: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      old_password: oldPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      message = body.detail ?? body.message ?? message;
    } catch {
      // ignore
    }
    throw new AuthError(message, res.status);
  }
}

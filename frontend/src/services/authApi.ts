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
  onboarding_completed: boolean;
  roles: UserRole[];
  terms_accepted: boolean;
  terms_accepted_at: string | null;
  terms_version: string | null;
  /** Issue #457: false only for students with no classroom enrollment. */
  has_classroom: boolean;
  /** Issue #457: mirrors ENFORCE_TEACHER_GATING env var on the backend. */
  teacher_gating_enforced: boolean;
}

/** Check if user has a specific role (ignores scope). */
export function hasRole(user: AuthUser | null, ...roleNames: string[]): boolean {
  if (!user) return false;
  return user.roles.some((r) => roleNames.includes(r.role_name));
}

/**
 * Check if user has a role scoped to a specific school.
 * Falls back to platform-scoped roles (e.g. system_admin).
 */
export function hasRoleInSchool(
  user: AuthUser | null,
  schoolId: number | null,
  ...roleNames: string[]
): boolean {
  if (!user) return false;
  return user.roles.some((r) => {
    if (!roleNames.includes(r.role_name)) return false;
    if (r.scope_type === 'platform') return true;
    if (r.scope_type === 'school' && schoolId != null && r.scope_id === String(schoolId)) return true;
    return false;
  });
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  must_change_password?: boolean;
  /** Issue #457: false for students not yet enrolled in any classroom. */
  has_classroom?: boolean;
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

export interface RegisterResponse {
  message: string;
  /** Dev/staging mode only: token returned directly for testing. Null in production. */
  verification_token: string | null;
  /** True when REQUIRE_EMAIL_VERIFICATION=false (staging/preview) — skip verify screen. */
  auto_verified?: boolean;
}

export async function register(
  email: string,
  password: string,
  name: string,
): Promise<RegisterResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return handleAuthResponse<RegisterResponse>(res);
}

export async function resendVerification(email: string): Promise<{ message: string; verification_token: string | null }> {
  const res = await fetch(`${API_BASE}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return handleAuthResponse(res);
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

export interface ForgotPasswordResponse {
  message: string;
  reset_token: string;
}

export async function forgotPassword(identifier: string): Promise<ForgotPasswordResponse> {
  const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier }),
  });
  return handleAuthResponse<ForgotPasswordResponse>(res);
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = await res.json();
      if (body.detail && typeof body.detail === 'object' && Array.isArray(body.detail.errors)) {
        message = body.detail.errors.join('；');
      } else {
        message = body.detail ?? body.message ?? message;
      }
    } catch {
      // ignore
    }
    throw new AuthError(message, res.status);
  }
}

export interface GoogleLoginResponse {
  access_token: string;
  token_type: string;
  is_new_user: boolean;
}

export async function googleLogin(credential: string): Promise<GoogleLoginResponse> {
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  return handleAuthResponse<GoogleLoginResponse>(res);
}

export interface JunyiLoginResponse {
  access_token: string;
  token_type: string;
  is_new_user: boolean;
}

/**
 * Exchange a Junyi SSO one-time auth code for a LingoLeap JWT (issue #1198).
 * The code is obtained from the /junyi-callback?code=<...> URL parameter.
 * It is single-use and expires in 600 seconds — must be sent immediately.
 */
export async function junyiLogin(code: string): Promise<JunyiLoginResponse> {
  const res = await fetch(`${API_BASE}/api/auth/junyi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return handleAuthResponse<JunyiLoginResponse>(res);
}

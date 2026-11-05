import { API_BASE } from './apiConfig';
/**
 * Auth API service — login, register, user info, password change.
 * Uses the same VITE_API_URL as api.ts.
 */


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
  /** Issue #3438: server-computed, live on every /users/me call — the
   *  authoritative source AuthContext derives `mustChangePassword` from. */
  must_change_password: boolean;
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
  /**
   * `Retry-After` 的秒數（#3227）—— 只有伺服器有講才有值。
   *
   * 429 的 `Retry-After` 是幾十秒，而 auth hydration 的快速重試預算是 200ms + 400ms，
   * 三次全花在同一個限流窗口裡 → 學生被丟回登入頁。有了這個值，背景續試才能
   * 等到對的時間點，而不是瞎猜。
   */
  retryAfterSeconds?: number;
  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** 讀 `Retry-After`（秒數格式）。看不懂或不合理就回 undefined，不要猜。 */
function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return undefined;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0 || n > 3600) return undefined;
  return n;
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
    throw new AuthError(message, res.status, parseRetryAfter(res));
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
  role?: 'parent',
): Promise<RegisterResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // #3804: role is only sent for a parent sign-up; omitted = student (default).
    body: JSON.stringify(role ? { email, password, name, role } : { email, password, name }),
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

/** #3804 self-serve teacher activation — PRD §10/§11, extended §4.4 (#3812). */
export interface ActivateTeacherSchool {
  id: number;
  name: string;
  is_new: boolean;
  /** Claude Security find_01RzZ2bXyjs6SrNmD7KkKy91 (high), 2026-11-05:
   * false for a genuinely pre-existing (MOE-imported/admin-created)
   * school — the teacher role exists but is pending a system_admin's
   * confirmation and cannot yet create a classroom or see any student
   * at that school. True for a self-activation-born school (brand new
   * or an earlier self-activation's), which stays immediately usable. */
  role_active: boolean;
}

export interface ActivateTeacherResponse {
  schools: ActivateTeacherSchool[];
  roles: UserRole[];
}

/** One school selection submitted to activate-teacher (#3812 §4.4) —
 * exactly one of the two must be set. See ActivateTeacherSchoolSelection in
 * ActivateTeacherPage.tsx for the richer UI-side row state this is built from. */
export interface ActivateTeacherSchoolInput {
  moe_school_code?: string;
  name?: string;
}

export async function activateTeacher(
  token: string,
  schools: ActivateTeacherSchoolInput[],
): Promise<ActivateTeacherResponse> {
  const res = await fetch(`${API_BASE}/api/users/me/activate-teacher`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ schools }),
  });
  return handleAuthResponse<ActivateTeacherResponse>(res);
}

/** #3812 §4.4 — GET /api/schools/directory/search result shapes. */
export interface SchoolDirectoryItem {
  id: number;
  moe_school_code: string;
  name: string;
  county_name: string | null;
  school_level: string | null;
  is_public: boolean | null;
}

export interface SchoolNameSuggestion {
  school_name: string;
  reason: string;
}

export interface SchoolDirectorySearchResponse {
  items: SchoolDirectoryItem[];
  total: number;
  suggestions: SchoolNameSuggestion[] | null;
}

export async function searchSchoolDirectory(
  token: string,
  county: string,
  q: string,
): Promise<SchoolDirectorySearchResponse> {
  const params = new URLSearchParams();
  if (county) params.set('county', county);
  if (q) params.set('q', q);
  const res = await fetch(`${API_BASE}/api/schools/directory/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleAuthResponse<SchoolDirectorySearchResponse>(res);
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

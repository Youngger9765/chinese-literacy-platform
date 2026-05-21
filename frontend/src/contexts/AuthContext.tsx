import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, register as apiRegister, getMe, acceptTerms as apiAcceptTerms, googleLogin as apiGoogleLogin, junyiLogin as apiJunyiLogin, AuthUser, AuthError, RegisterResponse } from '../services/authApi';
import { SESSION_UNAUTHORIZED_EVENT } from '../services/sessionGuard';
import { authToken, safeStorage } from '../utils/storage';

const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';
// Set when user logs in via Junyi SSO (#1260). Read on logout to also clear
// Junyi-side cookies via redirect to https://www.junyiacademy.org/logout —
// without this, Junyi auto-logs the user back in on next "使用均一帳號登入".
const JUNYI_SESSION_FLAG = 'lingoleap_junyi_session';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  loginPassword: string | null;
  needsTermsAcceptance: boolean;
  /**
   * Issue #457: false only for students with no classroom enrollment.
   * Derived from user.has_classroom; defaults to true while loading.
   */
  hasClassroom: boolean;
  /**
   * Issue #457: mirrors ENFORCE_TEACHER_GATING env var.
   * When false the classroom gate is dormant even if hasClassroom is false.
   */
  teacherGatingEnforced: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  register: (email: string, password: string, name: string) => Promise<RegisterResponse>;
  logout: (options?: { skipJunyiRedirect?: boolean }) => void;
  clearMustChangePassword: () => void;
  /** Re-fetch user data from /api/users/me and update the context. */
  refreshUser: () => Promise<void>;
  acceptTerms: () => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<{ isNewUser: boolean }>;
  /** Exchange a Junyi SSO one-time code for a LingoLeap session (issue #1198). */
  loginWithJunyi: (code: string) => Promise<{ isNewUser: boolean }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => authToken.get());
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loginPassword, setLoginPassword] = useState<string | null>(null);

  // Load user from stored token on mount (page reload / direct token hydration).
  // This effect watches [token] so it fires when the token first becomes available
  // from localStorage on mount.  During a fresh login, login() already fetches user
  // data and calls setUser() BEFORE calling setToken(), so by the time this effect
  // runs `user` is already set — we skip the redundant /me call in that case.
  // This eliminates the duplicate /api/users/me that was previously fired on every
  // login (Issue #1156).
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    // User already set by login() / loginWithGoogle() — no need to re-fetch /me.
    if (user) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    getMe(token)
      .then((userData) => {
        if (!cancelled) {
          setUser(userData);
        }
      })
      .catch(() => {
        // Token is invalid or expired — clear it
        if (!cancelled) {
          authToken.remove();
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]); // intentionally omit `user` — re-run only when token changes

  const login = useCallback(async (email: string, password: string): Promise<{ mustChangePassword: boolean }> => {
    const response = await apiLogin(email, password);
    const newToken = response.access_token;

    const needsPasswordChange = !!response.must_change_password;

    // Fetch user data ONCE here, then set user BEFORE setting token so that the
    // token-change useEffect above sees user !== null and skips its own /me call.
    // Previously getMe() was called here AND triggered again by the useEffect,
    // causing a duplicate /api/users/me on every login (Issue #1156).
    const userData = await getMe(newToken);

    authToken.set(newToken);
    // Email/password login is not Junyi — clear any stale Junyi flag from a
    // prior session in another tab to avoid logout() redirecting to Junyi.
    safeStorage.local.remove(JUNYI_SESSION_FLAG);
    setUser(userData);
    setToken(newToken);

    if (needsPasswordChange) {
      setMustChangePassword(true);
      setLoginPassword(password);
    }

    return { mustChangePassword: needsPasswordChange };
  }, []);

  const register = useCallback(async (email: string, password: string, name: string): Promise<RegisterResponse> => {
    // Registration no longer auto-logs in — user must verify email first (issue #460).
    const response = await apiRegister(email, password, name);
    return response;
  }, []);

  const loginWithGoogle = useCallback(async (credential: string): Promise<{ isNewUser: boolean }> => {
    const response = await apiGoogleLogin(credential);
    const newToken = response.access_token;
    // Same ordering as login(): fetch user first, then set user before token so
    // the token-change useEffect skips its redundant /me call (Issue #1156).
    const userData = await getMe(newToken);
    authToken.set(newToken);
    // Google login is not Junyi — clear any stale Junyi flag.
    safeStorage.local.remove(JUNYI_SESSION_FLAG);
    setUser(userData);
    setToken(newToken);
    return { isNewUser: response.is_new_user };
  }, []);

  const loginWithJunyi = useCallback(async (code: string): Promise<{ isNewUser: boolean }> => {
    const response = await apiJunyiLogin(code);
    const newToken = response.access_token;
    // Same ordering as loginWithGoogle: pre-fetch user so token-change useEffect
    // sees user !== null and skips the redundant /me call (Issue #1156).
    const userData = await getMe(newToken);
    authToken.set(newToken);
    // Mark session as Junyi-sourced so logout() also clears Junyi cookies (#1260).
    safeStorage.local.set(JUNYI_SESSION_FLAG, '1');
    setUser(userData);
    setToken(newToken);
    return { isNewUser: response.is_new_user };
  }, []);

  const logout = useCallback((options?: { skipJunyiRedirect?: boolean }) => {
    // Capture Junyi flag BEFORE clearing localStorage so we know whether to
    // round-trip through Junyi /logout (clears their cookies via Set-Cookie).
    // skipJunyiRedirect is set by the SESSION_UNAUTHORIZED auto-logout path so
    // expired-token recovery doesn't yank the user mid-page through Junyi.
    const wasJunyiSession = safeStorage.local.get(JUNYI_SESSION_FLAG) === '1';
    const shouldRedirectToJunyi = wasJunyiSession && !options?.skipJunyiRedirect;
    authToken.remove();
    safeStorage.local.remove(JUNYI_SESSION_FLAG);
    try {
      sessionStorage.removeItem('activeAssignmentId');
      sessionStorage.removeItem('activeAssignmentGoals');
      sessionStorage.removeItem(ACTIVE_ASSIGNMENT_CONTEXT_KEY);

      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (!key) continue;
        if (
          key.startsWith('db-session-')
          || key.startsWith('assignment-db-session-')
          || key.startsWith('self-db-session-')
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    } catch {
      // non-fatal
    }
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setLoginPassword(null);

    // For Junyi-sourced sessions (#1260), redirect through Junyi /logout to
    // clear Junyi-domain cookies (ureg_id, user_cookie_uuid, hashed_uuid, KAID).
    // Otherwise the next "使用均一帳號登入" auto-logs back in immediately
    // because the Junyi server sees a valid session cookie.
    // continue= sends user back to our /login after Junyi clears its cookies.
    if (shouldRedirectToJunyi && typeof window !== 'undefined') {
      const continueUrl = `${window.location.origin}/login`;
      window.location.href = `https://www.junyiacademy.org/logout?continue=${encodeURIComponent(continueUrl)}`;
    }
  }, []);

  // Any service that gets 401 (expired / invalid JWT) should fire this event so we
  // don't keep showing "logged in" while classroom tabs fail.
  useEffect(() => {
    const handler = () => {
      // Auto-logout from expired token: clear local state but DON'T round-trip
      // through Junyi /logout (would yank user mid-page on API 401).
      logout({ skipJunyiRedirect: true });
    };
    window.addEventListener(SESSION_UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(SESSION_UNAUTHORIZED_EVENT, handler);
  }, [logout]);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
    setLoginPassword(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const storedToken = authToken.get();
    if (!storedToken) return;
    try {
      const userData = await getMe(storedToken);
      setUser(userData);
    } catch {
      // Ignore — token may have expired; logout will handle that separately.
    }
  }, []);

  const acceptTerms = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    const updatedUser = await apiAcceptTerms(token);
    setUser(updatedUser);
  }, [token]);

  // Derived: user is authenticated but hasn't accepted terms
  const needsTermsAcceptance = !!user && !user.terms_accepted;

  // Issue #457: classroom gate state — default to true (safe) while loading
  const hasClassroom = user ? (user.has_classroom ?? true) : true;
  const teacherGatingEnforced = user ? (user.teacher_gating_enforced ?? false) : false;

  const value: AuthContextValue = {
    user,
    token,
    isAuthenticated: !!user,
    isLoading,
    mustChangePassword,
    loginPassword,
    needsTermsAcceptance,
    hasClassroom,
    teacherGatingEnforced,
    login,
    register,
    logout,
    clearMustChangePassword,
    refreshUser,
    acceptTerms,
    loginWithGoogle,
    loginWithJunyi,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, register as apiRegister, getMe, acceptTerms as apiAcceptTerms, googleLogin as apiGoogleLogin, AuthUser, AuthError, RegisterResponse } from '../services/authApi';
import { SESSION_UNAUTHORIZED_EVENT } from '../services/sessionGuard';

const TOKEN_KEY = 'lingoleap_token';
const ACTIVE_ASSIGNMENT_CONTEXT_KEY = 'activeAssignmentContext';

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
  logout: () => void;
  clearMustChangePassword: () => void;
  /** Re-fetch user data from /api/users/me and update the context. */
  refreshUser: () => Promise<void>;
  acceptTerms: () => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<{ isNewUser: boolean }>;
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
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loginPassword, setLoginPassword] = useState<string | null>(null);

  // Load user from stored token on mount
  useEffect(() => {
    if (!token) {
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
          localStorage.removeItem(TOKEN_KEY);
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
  }, [token]);

  const login = useCallback(async (email: string, password: string): Promise<{ mustChangePassword: boolean }> => {
    const response = await apiLogin(email, password);
    const newToken = response.access_token;
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);

    const needsPasswordChange = !!response.must_change_password;
    if (needsPasswordChange) {
      setMustChangePassword(true);
      setLoginPassword(password);
    }

    const userData = await getMe(newToken);
    setUser(userData);

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
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    const userData = await getMe(newToken);
    setUser(userData);
    return { isNewUser: response.is_new_user };
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
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
  }, []);

  // Any service that gets 401 (expired / invalid JWT) should fire this event so we
  // don't keep showing "logged in" while classroom tabs fail.
  useEffect(() => {
    const handler = () => {
      logout();
    };
    window.addEventListener(SESSION_UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(SESSION_UNAUTHORIZED_EVENT, handler);
  }, [logout]);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
    setLoginPassword(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

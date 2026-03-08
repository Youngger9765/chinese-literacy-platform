import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, register as apiRegister, getMe, acceptTerms as apiAcceptTerms, AuthUser, AuthError } from '../services/authApi';

const TOKEN_KEY = 'lingoleap_token';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  loginPassword: string | null;
  needsTermsAcceptance: boolean;
  login: (email: string, password: string) => Promise<{ mustChangePassword: boolean }>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  clearMustChangePassword: () => void;
  acceptTerms: () => Promise<void>;
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

  const register = useCallback(async (email: string, password: string, name: string) => {
    const response = await apiRegister(email, password, name);
    const newToken = response.access_token;
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);

    const userData = await getMe(newToken);
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setLoginPassword(null);
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
    setLoginPassword(null);
  }, []);

  const acceptTerms = useCallback(async () => {
    if (!token) throw new Error('Not authenticated');
    const updatedUser = await apiAcceptTerms(token);
    setUser(updatedUser);
  }, [token]);

  // Derived: user is authenticated but hasn't accepted terms
  const needsTermsAcceptance = !!user && !user.terms_accepted;

  const value: AuthContextValue = {
    user,
    token,
    isAuthenticated: !!user,
    isLoading,
    mustChangePassword,
    loginPassword,
    needsTermsAcceptance,
    login,
    register,
    logout,
    clearMustChangePassword,
    acceptTerms,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

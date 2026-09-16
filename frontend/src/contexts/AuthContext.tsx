import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { login as apiLogin, register as apiRegister, getMe, acceptTerms as apiAcceptTerms, googleLogin as apiGoogleLogin, junyiLogin as apiJunyiLogin, AuthUser, AuthError, RegisterResponse } from '../services/authApi';
import { SESSION_UNAUTHORIZED_EVENT } from '../services/sessionGuard';
import { authToken, safeStorage, clearAuthSession, JUNYI_SESSION_FLAG } from '../utils/storage';

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

/**
 * ⚠️ 直接讀這個 context 的唯一正當理由：**在沒有 `AuthProvider` 時要能安全退化**。
 *
 * `useAuth()` 沒有 Provider 會 throw，那對「有登入就加值、沒登入就照舊」的功能是錯的
 * 工具 —— 例如 `ZhuyinProvider`（#3224 要拿學生的錯字當難字）：有 12 個測試檔
 * render 真的 `ZhuyinProvider` 而沒有包 auth，用 `useAuth()` 會把它們全弄紅。
 *
 * 一般情況仍然用 `useAuth()`（它的 throw 是對的：那些地方沒登入就是 bug）。
 */
export const AuthContext = createContext<AuthContextValue | null>(null);

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

    // #3085: retry before concluding the session is unusable.
    //
    // #3037 already stopped a transient failure from deleting the token. But
    // the catch still ends in setUser(null), and isAuthenticated is !!user, so
    // ProtectedRoute sends the student to /login anyway. The token survives;
    // the student is looking at a login form in the middle of a lesson.
    //
    // "No verified user means not authenticated" is the right rule -- we must
    // not render authenticated UI for someone we cannot identify. So do not
    // weaken it; just stop reaching it over one bad request. A 401/403 is
    // believed immediately, because a dead token stays dead and retrying only
    // delays the login prompt.
    //
    // Seen in CI as full-qa A8, which walks seven lesson steps with a full
    // page load each: one of the seven landed on /login, a different step each
    // run -- the shape of a transient fault, not a broken step.
    const hydrate = async (): Promise<Awaited<ReturnType<typeof getMe>>> => {
      // Short on purpose. This runs before anything renders, so every
      // millisecond here is a student watching a spinner. Two quick attempts
      // absorb a blip; a server that is still failing after 600ms is not
      // going to be rescued by waiting longer, and the login screen is the
      // honest answer at that point.
      const backoffMs = [200, 400];
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await getMe(token);
        } catch (err: unknown) {
          const status = err instanceof AuthError ? err.status : undefined;
          const dead = status === 401 || status === 403;
          if (dead || attempt >= backoffMs.length) throw err;
          await new Promise((r) => setTimeout(r, backoffMs[attempt]));
        }
      }
    };

    hydrate()
      .then((userData) => {
        if (!cancelled) {
          setUser(userData);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // #3037: this catch used to fire for ANY rejection and delete the
        // token. But getMe() rejects for two unrelated reasons:
        //
        //   AuthError with status 401/403 -> the token really is dead.
        //   Anything else (fetch rejecting with TypeError on a dropped
        //   connection, a 5xx, a timeout) -> we simply do not know, and the
        //   token is probably fine.
        //
        // Treating the second as the first logs a student out on one bad
        // request: flaky classroom Wi-Fi, a phone changing towers, a Cloud
        // Run cold start. They then have to sign in again, because the token
        // was removed from localStorage, not just from memory.
        //
        // Observed in a Playwright trace of a real failure:
        //   200  /api/auth/login
        //   -1   /api/users/me      <- request-level failure, not an HTTP code
        const status = err instanceof AuthError ? err.status : undefined;
        const tokenIsReallyDead = status === 401 || status === 403;

        if (tokenIsReallyDead) {
          authToken.remove();
          setToken(null);
        }
        // Either way there is no user, so isAuthenticated stays false and
        // nothing authenticated renders. Keeping the token just means the
        // next attempt can succeed without a fresh login.
        setUser(null);

        // ── #3227 後半：留著 token 不夠，要真的把他救回來 ────────────────
        //
        // token 留著、`user` 是 null → `isAuthenticated` false → route gate
        // 把**手上拿著完全有效 token 的學生**導去登入頁。他得重新登入一次，
        // 而他的 token 明明還好的。
        //
        // 上面那個快速重試（200ms + 400ms）是刻意的短 —— 那是**阻塞階段**，
        // 每一毫秒都是學生在看 spinner。但一個限流（429）的 `Retry-After` 是
        // 幾十秒，三次快速重試全花在同一個窗口裡，必然全滅。
        //
        // 所以改成兩段：阻塞階段照舊短，**失敗後在背景繼續試**。
        // 學生先看到登入頁（誠實：現在真的沒登入），但只要伺服器恢復，
        // `setUser()` 會讓畫面自己變成已登入 —— 他不必重打帳密。
        //
        // ⛔ 不可以把阻塞階段拉長來解決這件事：那是拿「所有人都多等幾十秒」
        //    換「少數人不用重登」。
        if (!tokenIsReallyDead) {
          const retryAfter = err instanceof AuthError ? err.retryAfterSeconds : undefined;
          // 伺服器講了就聽它的（限流時它知道窗口何時結束），沒講就用退避梯度。
          // ⚠️ 上限 60 秒：再久的等待對「正在上課的學生」沒有意義，
          //    而 `Retry-After` 理論上可以是任意大的數字。
          const ladder = retryAfter !== undefined
            ? [Math.min(retryAfter, 60) * 1000, 15000, 30000]
            : [2000, 5000, 15000, 30000];
          void (async () => {
            for (const wait of ladder) {
              await new Promise((r) => setTimeout(r, wait));
              if (cancelled) return;
              try {
                const recovered = await getMe(token);
                if (cancelled) return;
                setUser(recovered);
                return;                       // 救回來了
              } catch (e: unknown) {
                const st = e instanceof AuthError ? e.status : undefined;
                if (st === 401 || st === 403) {
                  // 這次是真的死了 —— 清掉 token，跟阻塞階段同一個判準
                  if (!cancelled) {
                    authToken.remove();
                    setToken(null);
                  }
                  return;
                }
                // 還是不知道 —— 等下一格
              }
            }
          })();
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
    clearAuthSession();
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

/**
 * JunyiCallbackPage — handles the OAuth-like callback from Junyi SSO (issue #1198).
 *
 * Flow:
 * 1. Junyi redirects back to /junyi-callback?code=<one-time-code>(&state=<csrf-token>)
 * 2. This page immediately reads the code from the URL and exchanges it via loginWithJunyi().
 * 3. On success → navigate to the originally requested page (or home).
 * 4. On failure → show a clear error with a "retry" button that re-initiates SSO.
 *
 * Security:
 * - CSRF state is validated against sessionStorage before exchanging the code.
 * - The code is consumed and removed from the URL immediately to prevent re-use via back/reload.
 * - We call replaceState() before the exchange so the code never lingers in browser history.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { trackEvent } from '../utils/analytics';

const JUNYI_STATE_KEY = 'junyi_sso_state';

// Hosts registered in Junyi SSO whitelist. Callback origin MUST be one of these
// or Junyi silently refuses to redirect the ?code= back.
const WHITELISTED_CALLBACK_ORIGINS = [
  'https://lingoleap-prod.web.app',
  'https://lingoleap-staging.web.app',
  'https://lingoleap-dev.web.app',
];

/** True when the current origin is a Junyi-whitelisted host (SSO can round-trip). */
export function isSsoSupported(): boolean {
  return WHITELISTED_CALLBACK_ORIGINS.includes(window.location.origin);
}

/** Build the Junyi login URL pointing at a whitelisted callback origin. */
export function buildJunyiLoginUrl(returnTo: string = '/'): string {
  // Use current origin only if it is whitelisted; otherwise fall back to staging
  // (covers PR previews / Cloud Run direct URLs / localhost — SSO won't actually
  // complete there due to cross-origin sessionStorage, but at least the redirect
  // reaches a real host Junyi accepts instead of hanging).
  const callbackOrigin = isSsoSupported()
    ? window.location.origin
    : WHITELISTED_CALLBACK_ORIGINS[1]; // staging
  const callbackUrl = `${callbackOrigin}/junyi-callback?returnTo=${encodeURIComponent(returnTo)}`;

  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  sessionStorage.setItem(JUNYI_STATE_KEY, state);

  const continueUrl = `${callbackUrl}&state=${state}`;
  return `https://www.junyiacademy.org/login?continue=${encodeURIComponent(continueUrl)}`;
}

const JunyiCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithJunyi } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false); // prevent double-fire in React StrictMode

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    const returnTo = searchParams.get('returnTo') || '/';

    // --- CSRF state validation ---
    const storedState = sessionStorage.getItem(JUNYI_STATE_KEY);
    sessionStorage.removeItem(JUNYI_STATE_KEY);

    if (stateParam && storedState && stateParam !== storedState) {
      setError('登入驗證失敗（CSRF state 不符），請重新嘗試。');
      trackEvent('auth', 'junyi_login_csrf_mismatch');
      return;
    }

    if (!code) {
      setError('未收到均一登入憑證，請重新嘗試。');
      trackEvent('auth', 'junyi_login_no_code');
      return;
    }

    // Remove the code from the URL immediately so it never stays in browser history.
    window.history.replaceState({}, '', '/junyi-callback');

    loginWithJunyi(code)
      .then(({ isNewUser }) => {
        trackEvent('auth', isNewUser ? 'junyi_login_new_user' : 'junyi_login_success');
        navigate(returnTo, { replace: true });
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : '均一登入失敗，請稍後再試。';
        setError(message);
        trackEvent('auth', 'junyi_login_error');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — searchParams is stable at mount time

  const handleRetry = () => {
    window.location.href = buildJunyiLoginUrl('/');
  };

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4 text-center">
          <div className="text-4xl">均一登入失敗</div>
          <p className="text-red-600 text-sm">{error}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="w-full h-11 bg-[#FF6B35] hover:bg-[#e55a25] text-white rounded-lg font-bold text-sm transition-colors"
          >
            重新使用均一帳號登入
          </button>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="w-full h-11 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            返回登入頁
          </button>
        </div>
      </div>
    );
  }

  // Loading state — code is being exchanged with the backend
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-amber-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-10 h-10 border-4 border-[#FF6B35] border-t-transparent rounded-full animate-spin" />
        </div>
        <p className="text-gray-600 text-sm">正在驗證均一帳號...</p>
      </div>
    </div>
  );
};

export default JunyiCallbackPage;

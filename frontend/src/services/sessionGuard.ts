/**
 * When an authenticated API returns HTTP 401, dispatch an event so AuthProvider
 * can clear localStorage + context. Prevents stale "logged in" UI while JWT
 * is expired or rejected (user otherwise only sees raw "Invalid or expired token"
 * inside tabs).
 */
export const SESSION_UNAUTHORIZED_EVENT = 'lingoleap:session-unauthorized';

/** sessionStorage key used to restore the user's location after re-login. */
export const RETURN_URL_KEY = 'lingoleap_return_url';

export function notifySessionUnauthorized(): void {
  if (typeof window === 'undefined') return;

  // Preserve the current URL so LoginPage can redirect back after re-login.
  // Only save non-login paths to avoid redirect loops.
  const returnPath = window.location.pathname + window.location.search;
  if (returnPath && returnPath !== '/login') {
    sessionStorage.setItem(RETURN_URL_KEY, returnPath);
  }

  window.dispatchEvent(new CustomEvent(SESSION_UNAUTHORIZED_EVENT));
}

/** Call when `!res.ok` before reading body, so 401 triggers session clear. */
export function onApiUnauthorized(res: Response): void {
  if (res.status === 401) {
    notifySessionUnauthorized();
  }
}

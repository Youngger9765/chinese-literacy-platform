/**
 * When an authenticated API returns HTTP 401, dispatch an event so AuthProvider
 * can clear localStorage + context. Prevents stale "logged in" UI while JWT
 * is expired or rejected (user otherwise only sees raw "Invalid or expired token"
 * inside tabs).
 */
export const SESSION_UNAUTHORIZED_EVENT = 'lingoleap:session-unauthorized';

export function notifySessionUnauthorized(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_UNAUTHORIZED_EVENT));
}

/** Call when `!res.ok` before reading body, so 401 triggers session clear. */
export function onApiUnauthorized(res: Response): void {
  if (res.status === 401) {
    notifySessionUnauthorized();
  }
}

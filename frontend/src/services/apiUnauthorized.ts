/**
 * apiUnauthorized.ts — Shared 401 handler for service modules.
 *
 * Issue #1783: Centralizes the unauthorized event dispatch + SessionExpiredError
 * throw so services don't each inline inconsistent 401 logic.
 *
 * Usage:
 *   if (res.status === 401) await handle401Response(res, 'myApi: token expired');
 */

import { SESSION_UNAUTHORIZED_EVENT } from './sessionGuard';
import { SessionExpiredError } from './api';

/**
 * Dispatch the global session-unauthorized event so AuthProvider clears
 * localStorage + context. Safe to call from any service module.
 */
export function dispatchUnauthorized(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SESSION_UNAUTHORIZED_EVENT));
}

/**
 * Call when a fetch response has status 401.
 * Dispatches the unauthorized event (clears auth state) and throws
 * SessionExpiredError so callers can distinguish token expiry from other errors.
 *
 * Returns `never` — always throws.
 */
export async function handle401Response(
  _res: Response,
  message = 'Session expired',
): Promise<never> {
  dispatchUnauthorized();
  throw new SessionExpiredError(message);
}

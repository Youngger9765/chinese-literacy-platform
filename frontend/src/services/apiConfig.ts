/**
 * apiConfig.ts — Shared API configuration for all service modules.
 *
 * Issue #1785: Centralizes API_BASE so the 27 service files don't each
 * redefine `import.meta.env.VITE_API_URL ?? 'http://localhost:8000'`.
 *
 * Issue #1783: Provides ApiError + handle401Response to normalize 401
 * handling across services that previously threw inconsistent errors.
 */

/** Base URL for all API calls, resolved from Vite env at build time. */
export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

/** Typed API error that carries the HTTP status code. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Specialized error for HTTP 401 responses.
 * Extends ApiError so callers can distinguish token expiry from other errors
 * without duplicating the SessionExpiredError class across service files.
 *
 * Note: SessionExpiredError in api.ts extends plain Error for backwards compat
 * with existing catch blocks. This class is the canonical one for new code;
 * legacy code continues to use SessionExpiredError from api.ts.
 */
export class SessionExpiredApiError extends ApiError {
  constructor(message = 'Session expired') {
    super(message, 401);
    this.name = 'SessionExpiredApiError';
  }
}

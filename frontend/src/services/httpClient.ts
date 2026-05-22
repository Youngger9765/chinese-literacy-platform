/**
 * httpClient.ts — Centralized HTTP client for all API calls.
 *
 * Issue #1827: Replaces scattered raw fetch() + authHeaders duplication
 * across 27 service files with a single typed request function.
 */
import { API_BASE, ApiError, SessionExpiredApiError } from './apiConfig';
import { authToken } from '../utils/storage';

export { API_BASE, ApiError, SessionExpiredApiError };

export interface RequestOptions extends RequestInit {
  /** Auto-attach Authorization header (default: true) */
  auth?: boolean;
}

export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { auth = true, ...init } = options;

  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const token = authToken.get();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) throw new SessionExpiredApiError();
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      (body as { detail?: string }).detail ??
        `${init.method ?? 'GET'} ${path} failed: ${res.status}`,
      res.status
    );
  }
  return res.json() as Promise<T>;
}

export function get<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
  return request<T>(path, { ...options, method: 'GET' });
}

export function post<T>(
  path: string,
  body: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {}
): Promise<T> {
  return request<T>(path, { ...options, method: 'POST', body: JSON.stringify(body) });
}

export function put<T>(
  path: string,
  body: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {}
): Promise<T> {
  return request<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body) });
}

export function patch<T>(
  path: string,
  body: unknown,
  options: Omit<RequestOptions, 'method' | 'body'> = {}
): Promise<T> {
  return request<T>(path, { ...options, method: 'PATCH', body: JSON.stringify(body) });
}

export function del<T = void>(
  path: string,
  options: Omit<RequestOptions, 'method'> = {}
): Promise<T> {
  return request<T>(path, { ...options, method: 'DELETE' });
}

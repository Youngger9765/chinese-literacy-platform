/**
 * #3085 — a blip during hydration should not put a signed-in student on the
 * login screen.
 *
 * #3037 stopped a transient getMe() failure from deleting the token. But the
 * catch still ends in setUser(null), so isAuthenticated goes false and
 * ProtectedRoute sends them to /login. The token survives; the student does
 * not — they are looking at a login form in the middle of a lesson.
 *
 * Keeping "no verified user means not authenticated" is right: we should not
 * render authenticated UI for someone we cannot identify. The fix is to not
 * reach that state over one bad request. Retry first; give up only if the
 * server keeps failing.
 *
 * Seen in CI as full-qa A8, which walks seven lesson steps with a full page
 * load each. One of the seven would land on /login — a different step each
 * time, which is what a transient fault looks like.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const AUTH_TOKEN_KEY = 'lingoleap_token';
const getMe = vi.fn();
vi.mock('../../services/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/authApi')>();
  return { ...actual, getMe: (...a: unknown[]) => getMe(...a) };
});

import { AuthProvider, useAuth } from '../AuthContext';
import { AuthError } from '../../services/authApi';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

const A_USER = { id: 1, email: 'student@test.com', name: '小明', roles: [] };

describe('#3085 transient hydration failure', () => {
  beforeEach(() => {
    localStorage.clear();
    // reset, not clear: clearAllMocks wipes call history but leaves queued
    // ...Once implementations in place. An unconsumed mockResolvedValueOnce
    // from the previous test then answers this test's first call, and a test
    // that should have failed passes instead. Caught here by printing the
    // call count when a green looked unexplainable.
    getMe.mockReset();
    localStorage.setItem(AUTH_TOKEN_KEY, 'a-token-that-is-perfectly-fine');
  });

  it('stays signed in when the first getMe fails with a 5xx and the retry succeeds', async () => {
    getMe
      .mockRejectedValueOnce(new AuthError('bad gateway', 502))
      .mockResolvedValueOnce(A_USER as never);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    expect(
      result.current.isAuthenticated,
      'one 502 during hydration bounced a signed-in student to /login',
    ).toBe(true);
    expect(getMe.mock.calls.length, 'getMe was not retried at all').toBeGreaterThan(1);
  });

  it('stays signed in when the first getMe never reaches the server', async () => {
    getMe
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(A_USER as never);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('does NOT retry a 401 — a dead token is dead, and retrying just delays the login prompt', async () => {
    getMe.mockRejectedValue(new AuthError('unauthorized', 401));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    expect(result.current.isAuthenticated).toBe(false);
    expect(getMe.mock.calls.length, '401 should be believed the first time').toBe(1);
  });
});

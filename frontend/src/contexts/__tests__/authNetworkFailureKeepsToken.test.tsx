/**
 * #3037 — a network failure must not log the student out.
 *
 * AuthContext hydrates the user with getMe(token) and, on ANY rejection,
 * removed the token from localStorage. The comment said "Token is invalid
 * or expired", but that catch also fires when the request never reached the
 * server at all -- flaky classroom Wi-Fi, a phone changing towers, a Cloud
 * Run cold start. The student is logged out and has to sign in again.
 *
 * Evidence this is real, from a Playwright trace of an actual failure:
 *   200  /api/auth/login
 *   -1   /api/users/me     <- -1 is a request-level failure, not an HTTP code
 * and isAuthenticated is `!!user`, so no user == logged out.
 *
 * BOTH directions are locked here on purpose. Locking only "network failure
 * keeps the token" would let "never clear anything" pass, and then a truly
 * revoked token would keep a dead session alive forever.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';

const AUTH_TOKEN_KEY = 'lingoleap_token';

const getMe = vi.fn();
vi.mock('../../services/authApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/authApi')>();
  return { ...actual, getMe: (...a: unknown[]) => getMe(...a) };
});

import { AuthProvider, useAuth } from '../AuthContext';
import { AuthError } from '../../services/authApi';

function Probe() {
  const { isAuthenticated, isLoading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
    </div>
  );
}

const renderWithToken = async () => {
  localStorage.setItem(AUTH_TOKEN_KEY, 'a-token');
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('#3037 hydration failure handling', () => {
  it('KEEPS the token when the request never reached the server (fetch rejects)', async () => {
    // This is exactly what a dropped connection looks like to fetch().
    getMe.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderWithToken();
    expect(
      localStorage.getItem(AUTH_TOKEN_KEY),
      'a network blip must not sign the student out',
    ).toBe('a-token');
  });

  it('KEEPS the token on a 5xx (server having a bad moment, token still fine)', async () => {
    getMe.mockRejectedValue(new AuthError('Internal Server Error', 503));
    await renderWithToken();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe('a-token');
  });

  // The other direction. Without this, "never clear anything" would pass the
  // test above and leave a revoked session alive.
  it('CLEARS the token on 401 (the token really is invalid)', async () => {
    getMe.mockRejectedValue(new AuthError('Not authenticated', 401));
    await renderWithToken();
    expect(
      localStorage.getItem(AUTH_TOKEN_KEY),
      'a revoked token must not survive',
    ).toBeNull();
  });

  it('CLEARS the token on 403', async () => {
    getMe.mockRejectedValue(new AuthError('Forbidden', 403));
    await renderWithToken();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
  });

  it('is not authenticated in either case (no user == not authed)', async () => {
    getMe.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderWithToken();
    // Keeping the token is not the same as pretending we are logged in --
    // the app must still not render authenticated-only content.
    expect(screen.getByTestId('authed').textContent).toBe('false');
  });

  it('stops loading rather than hanging when hydration fails', async () => {
    getMe.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderWithToken();
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });
});

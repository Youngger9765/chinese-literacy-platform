// @vitest-environment-options {"url":"https://lingoleap-staging.web.app/"}

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JunyiCallbackPage, {
  buildJunyiLoginUrl,
  consumeJunyiPendingLogin,
} from '../JunyiCallbackPage';

const loginWithJunyi = vi.hoisted(() => vi.fn());

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ loginWithJunyi }),
}));

vi.mock('../../utils/analytics', () => ({
  trackEvent: vi.fn(),
}));

const PENDING_KEY = 'junyi_sso_pending';

interface PendingLogin {
  state: string;
  postLoginPath: string;
  expiresAt: number;
}

describe('Junyi public start URL', () => {
  beforeEach(() => {
    sessionStorage.clear();
    loginWithJunyi.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it('binds a safe post-login path to one expiring state', () => {
    const startedAt = Date.now();
    const junyiUrl = new URL(buildJunyiLoginUrl('/library?grade=6'));
    const finishedAt = Date.now();
    const callbackUrl = new URL(junyiUrl.searchParams.get('continue')!);
    const state = callbackUrl.searchParams.get('state');
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!) as PendingLogin;

    expect(junyiUrl.origin).toBe('https://www.junyiacademy.org');
    expect(junyiUrl.pathname).toBe('/login');
    expect(callbackUrl.origin).toBe(window.location.origin);
    expect(callbackUrl.pathname).toBe('/junyi-callback');
    expect(callbackUrl.searchParams.has('returnTo')).toBe(false);
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(pending).toEqual({
      state,
      postLoginPath: '/library?grade=6',
      expiresAt: expect.any(Number),
    });
    expect(pending.expiresAt).toBeGreaterThan(startedAt);
    expect(pending.expiresAt).toBeLessThanOrEqual(finishedAt + 600_000);

    expect(consumeJunyiPendingLogin('wrong-state')).toBeNull();
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
    expect(consumeJunyiPendingLogin(state)).toBe('/library?grade=6');
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it.each(['https://evil.example/phishing', '//evil.example/phishing'])(
    'falls back to home for external post-login URL %s',
    (externalUrl) => {
      buildJunyiLoginUrl(externalUrl);

      const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!) as PendingLogin;
      expect(pending.postLoginPath).toBe('/');
    },
  );

  it('rejects and clears an expired pending state', () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      state: 'expired',
      postLoginPath: '/library',
      expiresAt: Date.now() - 1,
    }));

    expect(consumeJunyiPendingLogin('expired')).toBeNull();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it.each([
    ['missing', ''],
    ['invalid', '&state=wrong-state'],
  ])('removes the code before rejecting %s state', async (_case, stateQuery) => {
    if (stateQuery) buildJunyiLoginUrl('/library');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    render(React.createElement(
      MemoryRouter,
      { initialEntries: [`/junyi-callback?code=one-time-code${stateQuery}`] },
      React.createElement(JunyiCallbackPage),
    ));

    expect(await screen.findByText(/state 缺少、不符或已過期/)).toBeInTheDocument();
    expect(replaceState).toHaveBeenCalledWith({}, '', '/junyi-callback');
    expect(loginWithJunyi).not.toHaveBeenCalled();
  });
});

// @vitest-environment-options {"url":"https://lingoleap-staging.web.app/"}
//
// buildJunyiLoginUrl() writes the CSRF state to sessionStorage, which throws when
// the browser blocks storage (Safari private mode, locked-down school iPads).
// Both click handlers that call it must catch — an uncaught throw inside an
// onClick leaves the button looking dead with no message at all.

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JunyiCallbackPage, { JUNYI_START_FAILED_MESSAGE } from '../JunyiCallbackPage';
import LoginPage from '../LoginPage';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    loginWithJunyi: vi.fn(),
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
  }),
}));

vi.mock('../../utils/analytics', () => ({ trackEvent: vi.fn() }));

vi.mock('../../components/GoogleSignInButton', () => ({
  default: () => null,
}));

function blockSessionStorageWrites() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  });
}

describe('Junyi SSO start with blocked sessionStorage', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('shows a message instead of a dead button on the login page', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    blockSessionStorageWrites();
    await user.click(screen.getByRole('button', { name: /使用均一帳號登入/ }));

    expect(await screen.findByText(JUNYI_START_FAILED_MESSAGE)).toBeInTheDocument();
  });

  it('shows a message instead of a dead button on the callback retry', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/junyi-callback']}>
        <JunyiCallbackPage />
      </MemoryRouter>,
    );

    // No ?code= → the page is already in its error state, which renders retry.
    const retry = await screen.findByRole('button', { name: '重新使用均一帳號登入' });

    blockSessionStorageWrites();
    await user.click(retry);

    expect(await screen.findByText(JUNYI_START_FAILED_MESSAGE)).toBeInTheDocument();
  });
});

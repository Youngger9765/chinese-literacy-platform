/**
 * LoginPage — preserves the query string on post-login redirect (#3081 AC3).
 *
 * A student who scans a classroom-join QR while logged out lands on
 * `/join?code=XXXXXX`. `ProtectedRoute` (RouteGuards.tsx) bounces them to
 * `/login` carrying the *full* `location` (pathname + search) as
 * `state.from`. This file locks that `?code=` actually survives the round
 * trip -- LoginPage used to reconstruct only `state.from.pathname`, dropping
 * the query string, so the student would land back on a bare `/join` and be
 * right back to typing the code by hand. That's the whole point of the QR
 * flow, silently defeated. See LoginPage.tsx's `from` derivation for the fix.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import LoginPage from '../LoginPage';

const login = vi.fn();

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    login,
    loginWithGoogle: vi.fn(),
  }),
}));

// Real react-router navigation, asserted by what actually mounts at the
// destination -- not by inspecting a mocked navigate() call, which would
// only prove LoginPage *tried* to call navigate with some argument, not that
// react-router actually landed where we think.
const LandingProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="landed">{`${location.pathname}${location.search}`}</div>;
};

function renderAt(from: { pathname: string; search: string }) {
  return render(
    <MemoryRouter
      initialEntries={[{ pathname: '/login', state: { from } }]}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join" element={<LandingProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage — post-login redirect keeps the query string (#3081 AC3)', () => {
  it('returns to /join?code=ABC123, not a bare /join', async () => {
    login.mockResolvedValueOnce({ mustChangePassword: false });
    renderAt({ pathname: '/join', search: '?code=ABC123' });

    fireEvent.change(screen.getByPlaceholderText('email@example.com 或 ABC1231'), {
      target: { value: 'student@test.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('輸入密碼'), {
      target: { value: 'demo1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId('landed').textContent).toBe('/join?code=ABC123');
  });

  it('still redirects correctly when there is no query string (no regression on the plain case)', async () => {
    login.mockResolvedValueOnce({ mustChangePassword: false });
    renderAt({ pathname: '/join', search: '' });

    fireEvent.change(screen.getByPlaceholderText('email@example.com 或 ABC1231'), {
      target: { value: 'student@test.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('輸入密碼'), {
      target: { value: 'demo1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => expect(screen.getByTestId('landed')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId('landed').textContent).toBe('/join');
  });
});

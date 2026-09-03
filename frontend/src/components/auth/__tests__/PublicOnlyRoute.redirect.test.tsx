/**
 * PublicOnlyRoute — respects `state.from` instead of hardcoding `/` (#3081).
 *
 * Root cause chain (found via real staging repro with history.pushState/
 * replaceState hooked, not code-reading -- see LoginPage.redirect.test.tsx
 * for the sibling half of this fix):
 *
 *   1. Anonymous student scans a classroom-join QR -> `/join?code=X`
 *   2. ProtectedRoute (guarding /join) redirects to `/login`, setting
 *      `state.from` = the full location (pathname + search)
 *   3. LoginPage reads `state.from` and, after a successful login, calls
 *      `navigate(from, {replace:true})` -> browser replaces to `/join?code=X`
 *   4. PublicOnlyRoute (guarding /login) reacts to the SAME `isAuthenticated`
 *      flip and used to unconditionally `<Navigate to="/" replace/>`,
 *      racing step 3 and (observed empirically) always winning -- the URL
 *      bar ends up at `/` and then bounces again via HomePage's own
 *      role redirect (`/` -> `/student` or `/teacher-home`).
 *
 * Staging trace with the pre-fix code, for `/join?code=ZZTEST9` AND for
 * `/dictionary` (proving this is not `/join`-specific):
 *   ["/login", "replace:/join", "replace:/", "replace:/student"]
 *
 * This file locks step 4: PublicOnlyRoute must redirect to the *same*
 * `state.from` ProtectedRoute set, so it no longer matters which of the two
 * competing redirects physically wins the race.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { PublicOnlyRoute } from '../RouteGuards';

let mockIsAuthenticated = true;
let mockIsLoading = false;

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated, isLoading: mockIsLoading }),
}));

const LandingProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="landed">{`${location.pathname}${location.search}`}</div>;
};

function renderAt(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <div>login form</div>
            </PublicOnlyRoute>
          }
        />
        <Route path="/join" element={<LandingProbe />} />
        <Route path="/" element={<LandingProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicOnlyRoute — redirects to state.from, not a hardcoded "/" (#3081)', () => {
  it('sends an already-authenticated user to state.from (pathname + search), matching ProtectedRoute', () => {
    renderAt({ from: { pathname: '/join', search: '?code=ABC123' } });
    expect(screen.getByTestId('landed').textContent).toBe('/join?code=ABC123');
  });

  it('falls back to "/" when there is no state.from (no regression on the plain /login visit)', () => {
    renderAt(undefined);
    expect(screen.getByTestId('landed').textContent).toBe('/');
  });
});

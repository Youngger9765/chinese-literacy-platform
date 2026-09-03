/**
 * Integration lock for the FULL /join QR redirect chain (#3081).
 *
 * Unlike LoginPage.redirect.test.tsx and PublicOnlyRoute.redirect.test.tsx,
 * which each mock `useAuth()` in isolation to lock their own fix, this file
 * renders the REAL AuthProvider + REAL ProtectedRoute + REAL PublicOnlyRoute
 * + REAL LoginPage together. That matters here specifically because the bug
 * is a RACE: two different `useAuth()` consumers (LoginPage and
 * PublicOnlyRoute) react to the SAME `isAuthenticated` state flip in the
 * same render pass. A hand-mocked `useAuth()` per test file can prove each
 * fix works in isolation, but cannot prove the two fixes still agree once
 * React actually batches and orders their updates together -- only a real,
 * shared AuthProvider driving both consumers reproduces that.
 *
 * Root cause chain (found via real staging repro with history.pushState/
 * replaceState hooked -- see the two sibling files for narrative detail):
 *   1. `pages/LoginPage.tsx` used to compute the post-login redirect target
 *      from `state.from.pathname` only, dropping `?code=`.
 *   2. `components/auth/RouteGuards.tsx`'s PublicOnlyRoute (guarding
 *      /login) used to unconditionally `<Navigate to="/" replace/>` the
 *      instant `isAuthenticated` flipped true -- racing LoginPage's own
 *      redirect and, verified on staging, always winning.
 * Fixing only #1 still leaves the user bounced through `/` to a role home
 * by #2. This test asserts the WHOLE chain, not just the final URL.
 *
 * ⚠️ Mutation testing this file surfaced something worth being explicit
 * about, rather than silently assuming this one test locks both fixes:
 * reverting #2 alone DOES turn this test red (verified -- the chain times
 * out waiting for the /join probe because it lands on "/" instead). But
 * reverting #1 alone does NOT turn this test red, because #2's redirect
 * reads `location.state.from` fresh off the router -- independently of
 * whatever LoginPage's own (possibly-buggy) `from` variable computed -- and
 * #2's effect empirically always fires after LoginPage's synchronous
 * navigate() call, so #2's correct target wins the race regardless of what
 * #1 computed. #2 masks #1 along this specific code path.
 *
 * #1 is still real and still worth keeping: it is the only thing that
 * matters for the Junyi SSO button (`handleJunyiLogin` -> a plain
 * `window.location.href` navigation that never touches PublicOnlyRoute) and
 * it is defense-in-depth for the react-router paths. Its OWN regression
 * lock is `LoginPage.redirect.test.tsx`, which deliberately renders
 * LoginPage WITHOUT the PublicOnlyRoute wrapper so #2 cannot mask it there.
 * Together, `LoginPage.redirect.test.tsx` (locks #1 in isolation) +
 * `PublicOnlyRoute.redirect.test.tsx` (locks #2 in isolation) + this file
 * (locks the shipped end-to-end behavior) is the actual coverage; this file
 * alone is not a substitute for the other two.
 */
import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ProtectedRoute, PublicOnlyRoute } from '../../components/auth/RouteGuards';
import LoginPage from '../LoginPage';

const DEMO_USER = {
  id: 42,
  email: 'student@test.com',
  name: 'Test Student',
  is_active: true,
  onboarding_completed: true,
  roles: [{ role_name: 'student', role_display_name: 'Student', scope_type: 'school', scope_id: null }],
  terms_accepted: true,
  terms_accepted_at: null,
  terms_version: null,
  has_classroom: true,
  teacher_gating_enforced: false,
};

function fakeFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
    if (url.includes('/api/auth/login')) {
      return new Response(JSON.stringify({ access_token: 'test-token', must_change_password: false }), {
        status: 200,
      });
    }
    if (url.includes('/api/users/me')) {
      return new Response(JSON.stringify(DEMO_USER), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

let navHistory: string[] = [];

const RecordLocation: React.FC = () => {
  const location = useLocation();
  useEffect(() => {
    navHistory.push(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);
  return null;
};

const JoinProbe: React.FC = () => <div data-testid="join-probe">JOIN PAGE (code prefilled here)</div>;
const HomeProbe: React.FC = () => (
  <div data-testid="home-probe">HOME (role redirect target -- should never render)</div>
);

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/join?code=ABC123']}>
      <AuthProvider>
        <RecordLocation />
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/join"
            element={
              <ProtectedRoute>
                <JoinProbe />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<HomeProbe />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Full /join QR redirect chain -- unauthenticated scan through to landing (#3081)', () => {
  beforeEach(() => {
    navHistory = [];
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', fakeFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lands on /join?code=ABC123 after login, and the chain never visits "/" or a role home', async () => {
    renderApp();

    // ProtectedRoute bounces the anonymous visitor to /login.
    await waitFor(() =>
      expect(screen.getByPlaceholderText('email@example.com 或 ABC1231')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText('email@example.com 或 ABC1231'), {
      target: { value: 'student@test.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('輸入密碼'), { target: { value: 'demo1234' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));

    await waitFor(() => expect(screen.getByTestId('join-probe')).toBeInTheDocument(), { timeout: 3000 });

    // The whole chain, not just the endpoint -- "/" appearing ANYWHERE (even
    // if something later corrected it) proves the race was lost at least once.
    expect(navHistory).not.toContain('/');
    expect(screen.queryByTestId('home-probe')).toBeNull();

    // The first post-/login landing must be the exact QR target, not a
    // detour through "/" that happens to end up back here.
    // waitFor, not a bare assertion: RecordLocation writes navHistory from a
    // useEffect, and the probe appearing in the DOM does not guarantee that
    // effect has committed yet. Reading navHistory synchronously here caught
    // the array one entry short -- ending at '/login' -- and reported
    // `undefined`, which reads exactly like "the redirect never happened".
    await waitFor(() => {
      const loginIndex = navHistory.indexOf('/login');
      expect(loginIndex).toBeGreaterThanOrEqual(0);
      const afterLogin = navHistory.slice(loginIndex + 1);
      expect(afterLogin[0], `chain was ${JSON.stringify(navHistory)}`).toBe('/join?code=ABC123');
    });
  });
});

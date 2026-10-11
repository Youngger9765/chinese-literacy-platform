/**
 * ProtectedRoute — the password-change gate must win over the ToS gate (#3412).
 *
 * A freshly batch-created student (or one whose password a teacher just
 * reset) has BOTH `mustChangePassword` and `needsTermsAcceptance` true at
 * the same time -- neither has ever been done. LoginPage navigates them to
 * `/change-password` first, but ProtectedRoute's ToS check only excluded
 * `/terms` from its own redirect target, not `/change-password`.
 *
 * `/change-password` is a protected route too (AppRoutes.tsx), so the
 * instant ProtectedRoute re-evaluates on that path it saw
 * needsTermsAcceptance=true and bounced to /terms -- and nothing on /terms
 * ever sends the student back to /change-password afterward. The forced
 * password change is skipped permanently; the teacher-issued password
 * (printed on a credential card) stays valid forever.
 *
 * Fix: mustChangePassword must be resolved before needsTermsAcceptance is
 * even consulted, so a pending password change can never be shadowed by
 * the ToS gate, regardless of which page the student lands on first.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ProtectedRoute } from '../RouteGuards';

let mockAuth: {
  isAuthenticated: boolean;
  isLoading: boolean;
  needsTermsAcceptance: boolean;
  mustChangePassword: boolean;
};

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const LandingProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="landed">{location.pathname}</div>;
};

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/change-password" element={
          <ProtectedRoute><div data-testid="change-password-page">cp</div></ProtectedRoute>
        } />
        <Route path="/terms" element={
          <ProtectedRoute><div data-testid="terms-page">tp</div></ProtectedRoute>
        } />
        <Route path="/library" element={
          <ProtectedRoute><div data-testid="library-page">lib</div></ProtectedRoute>
        } />
      </Routes>
      <LandingProbe />
    </MemoryRouter>,
  );
}

describe('ProtectedRoute guard order', () => {
  it('both pending, on /change-password: stays, no bounce to /terms', () => {
    mockAuth = { isAuthenticated: true, isLoading: false, needsTermsAcceptance: true, mustChangePassword: true };
    renderAt('/change-password');
    expect(screen.getByTestId('landed').textContent).toBe('/change-password');
    expect(screen.queryByTestId('change-password-page')).not.toBeNull();
  });
  it('both pending, on /library: sent to /change-password, not /terms', () => {
    mockAuth = { isAuthenticated: true, isLoading: false, needsTermsAcceptance: true, mustChangePassword: true };
    renderAt('/library');
    expect(screen.getByTestId('landed').textContent).toBe('/change-password');
  });
  it('both pending, on /terms first: still redirected to /change-password', () => {
    mockAuth = { isAuthenticated: true, isLoading: false, needsTermsAcceptance: true, mustChangePassword: true };
    renderAt('/terms');
    expect(screen.getByTestId('landed').textContent).toBe('/change-password');
  });
  it('terms-only (no regression): /library still redirects to /terms', () => {
    mockAuth = { isAuthenticated: true, isLoading: false, needsTermsAcceptance: true, mustChangePassword: false };
    renderAt('/library');
    expect(screen.getByTestId('landed').textContent).toBe('/terms');
  });
  it('password-only: /library redirects to /change-password', () => {
    mockAuth = { isAuthenticated: true, isLoading: false, needsTermsAcceptance: false, mustChangePassword: true };
    renderAt('/library');
    expect(screen.getByTestId('landed').textContent).toBe('/change-password');
  });
  it('neither pending: /library renders normally, no redirect', () => {
    mockAuth = { isAuthenticated: true, isLoading: false, needsTermsAcceptance: false, mustChangePassword: false };
    renderAt('/library');
    expect(screen.getByTestId('landed').textContent).toBe('/library');
    expect(screen.getByTestId('library-page')).toBeTruthy();
  });
});

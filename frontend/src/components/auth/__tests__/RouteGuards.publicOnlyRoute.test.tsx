import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { PublicOnlyRoute } from '../RouteGuards';

let mockAuth: {
  isAuthenticated: boolean;
  isLoading: boolean;
  mustChangePassword: boolean;
  needsTermsAcceptance: boolean;
};

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const LandingProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="landed">{location.pathname}</div>;
};

function renderAtLogin(): void {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route
          path="/login"
          element={(
            <PublicOnlyRoute>
              <div>login page</div>
            </PublicOnlyRoute>
          )}
        />
        <Route path="/change-password" element={<LandingProbe />} />
        <Route path="/terms" element={<LandingProbe />} />
        <Route path="/" element={<LandingProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicOnlyRoute pending-account gates', () => {
  it('sends a forced-password-change user to /change-password instead of /', () => {
    mockAuth = {
      isAuthenticated: true,
      isLoading: false,
      mustChangePassword: true,
      needsTermsAcceptance: false,
    };

    renderAtLogin();

    expect(screen.getByTestId('landed').textContent).toBe('/change-password');
  });
});

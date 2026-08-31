import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { junyiNavigation } from '../../pages/JunyiStartPage';

const buildJunyiLoginUrl = vi.hoisted(() => vi.fn(() => '#junyi'));

vi.mock('../../components/auth/RouteGuards', () => ({
  PublicOnlyRoute: ({ children }: { children: React.ReactNode }) => children,
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => children,
  StudentClassroomGuard: ({ children }: { children: React.ReactNode }) => children,
  LearningRouteGate: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../pages/JunyiCallbackPage', () => ({
  default: () => null,
  buildJunyiLoginUrl,
  isSsoSupported: () => true,
}));

import AppRoutes from '../AppRoutes';

describe('Junyi start route', () => {
  it('starts exactly once with post_login_path, including in StrictMode', () => {
    const replace = vi.spyOn(junyiNavigation, 'replace').mockImplementation(() => {});

    render(
      <React.StrictMode>
        <MemoryRouter initialEntries={['/auth/junyi/start?post_login_path=%2Flibrary']}>
          <AppRoutes />
        </MemoryRouter>
      </React.StrictMode>,
    );

    expect(screen.getByText('正在前往均一登入...')).toBeInTheDocument();
    expect(buildJunyiLoginUrl).toHaveBeenCalledTimes(1);
    expect(buildJunyiLoginUrl).toHaveBeenCalledWith('/library');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('#junyi');
  });
});

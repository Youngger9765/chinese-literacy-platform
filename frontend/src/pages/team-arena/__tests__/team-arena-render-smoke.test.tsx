/**
 * team-arena-render-smoke.test.tsx — same spirit as pk-render-smoke.test.tsx
 * (Gate ① of the frontend render-safety net, #2279/#2289): mount each
 * team_arena page and assert none of them throw at mount. API calls are
 * mocked to never resolve so each page stays in its initial loading state.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: '小明' },
    token: 'fake-token',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('../../../services/teamArenaApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/teamArenaApi')>(
    '../../../services/teamArenaApi',
  );
  return {
    ...actual,
    createTeamArenaSession: vi.fn(() => new Promise(() => {})),
    joinTeamArenaSession: vi.fn(() => new Promise(() => {})),
    assignTeamArenaTeams: vi.fn(() => new Promise(() => {})),
    claimTeamArenaLane: vi.fn(() => new Promise(() => {})),
    controlTeamArena: vi.fn(() => new Promise(() => {})),
    getTeamArenaState: vi.fn(() => new Promise(() => {})),
    submitTeamArenaAnswer: vi.fn(() => new Promise(() => {})),
    getTeamArenaResult: vi.fn(() => new Promise(() => {})),
  };
});

vi.mock('../../../services/classroomApi', () => ({
  listMyClassrooms: vi.fn(() => new Promise(() => {})),
  updateClassroomFeatureSettings: vi.fn(() => new Promise(() => {})),
}));

import StudentTeamArenaJoin from '../StudentTeamArenaJoin';
import StudentTeamArenaPlay from '../StudentTeamArenaPlay';
import TeacherTeamArenaHost from '../../teacher/team-arena/TeacherTeamArenaHost';

function renderAt(path: string, routePath: string, Element: React.FC) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<Element />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('team_arena pages mount without throwing', () => {
  it('StudentTeamArenaJoin', () => {
    expect(() => renderAt('/team-arena', '/team-arena', StudentTeamArenaJoin)).not.toThrow();
  });

  it('StudentTeamArenaPlay', () => {
    expect(() => renderAt('/team-arena/AB12CD', '/team-arena/:code', StudentTeamArenaPlay)).not.toThrow();
  });

  it('TeacherTeamArenaHost — setup (no code)', () => {
    expect(() => renderAt('/teacher/team-arena', '/teacher/team-arena', TeacherTeamArenaHost)).not.toThrow();
  });

  it('TeacherTeamArenaHost — hosting (with code)', () => {
    expect(() =>
      renderAt('/teacher/team-arena/AB12CD', '/teacher/team-arena/:code', TeacherTeamArenaHost),
    ).not.toThrow();
  });
});

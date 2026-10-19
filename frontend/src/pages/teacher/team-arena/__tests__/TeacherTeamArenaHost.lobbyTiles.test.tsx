/**
 * Critic review (slice 3) found a guaranteed crash: right after 自動分隊
 * but before 開始比賽, the backend's team tiles have no towers_down/
 * base_hits/score fields yet (only `_start()` populates them) — this
 * mounts the REAL component with that exact resolved (not permanently
 * pending) state shape, so it actually exercises the render path the
 * render-smoke test's never-resolving mock skips entirely.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: '老師' },
    token: 'fake-token',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

const { mockGetTeamArenaState } = vi.hoisted(() => ({ mockGetTeamArenaState: vi.fn() }));

vi.mock('../../../../services/teamArenaApi', async () => {
  const actual = await vi.importActual<typeof import('../../../../services/teamArenaApi')>(
    '../../../../services/teamArenaApi',
  );
  return { ...actual, getTeamArenaState: mockGetTeamArenaState };
});

import TeacherTeamArenaHost from '../TeacherTeamArenaHost';

function renderHost() {
  return render(
    <MemoryRouter initialEntries={['/teacher/team-arena/AB12CD']}>
      <Routes>
        <Route path="/teacher/team-arena/:code" element={<TeacherTeamArenaHost />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TeacherTeamArenaHost — lobby tiles right after auto-assign', () => {
  it('renders well-formed tiles without throwing (pre-fix: threw on team.towers_down[lane])', async () => {
    mockGetTeamArenaState.mockResolvedValue({
      code: 'AB12CD',
      status: 'lobby',
      turn_no: 0,
      state_version: 1,
      story: {
        key: null,
        team_labels: ['青隊', '橙隊'],
        intro: '',
        background_art: null,
        energy_bar_label: '書塔亮度',
        result_copy: { win: '', lose: '', draw: '' },
      },
      matches: {
        '0:0': { towers_down: { zhuyin: 0, vocab_definitions: 0, vocab_application: 0, comprehension: 0 }, base_hits: 0, score: 0, match_status: 'active', winner: null },
        '0:1': { towers_down: { zhuyin: 0, vocab_definitions: 0, vocab_application: 0, comprehension: 0 }, base_hits: 0, score: 0, match_status: 'active', winner: null },
      },
    });

    renderHost();

    await waitFor(() => expect(screen.getByText(/青隊/)).toBeInTheDocument());
    expect(screen.getByText(/橙隊/)).toBeInTheDocument();
    expect(screen.getAllByText('0/2').length).toBeGreaterThan(0);
  });

  it('renders consistent winner on both tiles of an ended match (pre-fix: side b showed the flipped winner)', async () => {
    mockGetTeamArenaState.mockResolvedValue({
      code: 'AB12CD',
      status: 'ended',
      turn_no: 10,
      state_version: 5,
      story: {
        key: null,
        team_labels: ['青隊', '橙隊'],
        intro: '',
        background_art: null,
        energy_bar_label: '書塔亮度',
        result_copy: { win: '', lose: '', draw: '' },
      },
      matches: {
        '0:0': { towers_down: { zhuyin: 2, vocab_definitions: 0, vocab_application: 0, comprehension: 0 }, base_hits: 2, score: 500, match_status: 'ended', winner: 'a' },
        '0:1': { towers_down: { zhuyin: 0, vocab_definitions: 0, vocab_application: 0, comprehension: 0 }, base_hits: 0, score: 100, match_status: 'ended', winner: 'a' },
      },
    });

    renderHost();

    await waitFor(() => expect(screen.getAllByText(/左隊獲勝/).length).toBe(2));
  });
});

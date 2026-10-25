/**
 * #3777 (game-academy audit r2, P1-2): the choose screen (StudentTeamArenaJoin,
 * before joining a room) already has a hero banner with the tower
 * illustration (#3761 round 3) — but it never extended to THIS screen, the
 * in-game waiting room (`state.status === 'lobby'`, shown after a room is
 * created/joined, while both teams fill up). That lobby was still plain
 * text ("比賽代碼" + a bare mono code), visually inconsistent with PK/
 * escape-room/live-quiz's own waiting rooms, which all got a hero banner.
 * Locks that this screen now reuses the same tower illustration asset.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, name: '武士1' }, token: 'fake-token', isAuthenticated: true, isLoading: false }),
}));

let mockState: unknown = null;
vi.mock('../../../components/team-arena/useTeamArenaPoll', () => ({
  useTeamArenaPoll: () => ({ state: mockState, error: null, loading: false }),
}));

vi.mock('../../../services/teamArenaApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/teamArenaApi')>('../../../services/teamArenaApi');
  return {
    ...actual,
    getTeamArenaState: vi.fn(() => new Promise(() => {})),
    joinTeamArenaSession: vi.fn(() => Promise.resolve({ code: 'ABC123', status: 'lobby' })),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

function lobbyState() {
  return {
    code: 'ABC123',
    status: 'lobby',
    turn_no: 0,
    state_version: 1,
    story: { key: null, team_labels: ['甲隊', '乙隊'], intro: '', background_art: null, energy_bar_label: '', result_copy: { win: '', lose: '', draw: '' } },
    team_size: 2,
    is_host: true,
    showdown: false,
    sides: {
      a: { seated: 1, team_size: 2, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [{ display_name: '武士1', student_id: 7 }] },
      b: { seated: 0, team_size: 2, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
    },
    own_match: null,
  };
}

function renderPlay() {
  return render(
    <MemoryRouter initialEntries={['/team-arena/ABC123?side=a']}>
      <Routes>
        <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentTeamArenaPlay in-game lobby hero banner (#3777)', () => {
  it('shows the same tower illustration the choose screen and game-hub card use', async () => {
    mockState = lobbyState();
    renderPlay();
    await screen.findByText('比賽代碼');
    const img = document.querySelector('img[src="/story-assets/team-arena-hub/icon.png"]');
    expect(img).toBeTruthy();
  });

  it('still shows the match code and both teams (banner is additive, not a replacement)', async () => {
    mockState = lobbyState();
    renderPlay();
    expect(await screen.findByText('ABC123')).toBeTruthy();
    expect(screen.getByText('武士1')).toBeTruthy();
  });
});

/**
 * #3771 (game-academy audit r2, P0-2): the team-arena result screen had
 * ZERO interactive elements — a student could only leave via the browser's
 * own back button. Locks that GameResultActions is wired in with a working
 * "再玩一場" (→ /team-arena) and "回遊戲區" (→ /game-hub).
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
    joinTeamArenaSession: vi.fn(() => Promise.resolve({ code: 'ABC123', status: 'playing' })),
    getTeamArenaResult: vi.fn(() =>
      Promise.resolve({
        sides: {
          a: { towers_destroyed: 0, base_destroyed: false, match_status: 'ended', winner: 'a' },
          b: { towers_destroyed: 3, base_destroyed: false, match_status: 'ended', winner: 'a' },
        },
        players: {
          a: [{ student_id: 1, display_name: '武士1', highlight: '打倒了一座塔' }],
          b: [{ student_id: 4, display_name: '武士4', highlight: '完整參與了這場比賽' }],
        },
        me: { my_side: 'a', highlight: '打倒了一座塔' },
      }),
    ),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

function endedState() {
  return {
    code: 'ABC123',
    status: 'ended',
    turn_no: 5,
    state_version: 9,
    story: { key: null, team_labels: ['甲隊', '乙隊'], intro: '', background_art: null, energy_bar_label: '', result_copy: { win: '', lose: '', draw: '' } },
    team_size: 3,
    is_host: true,
    showdown: false,
    sides: {
      a: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 0, base_destroyed: true, match_status: 'ended', winner: 'a', members: [] },
      b: { seated: 3, team_size: 3, towers_destroyed: 3, current_hp: 100, base_destroyed: false, match_status: 'ended', winner: 'a', members: [] },
    },
    own_match: {
      my_side: 'a',
      match_status: 'ended',
      winner: 'a',
      am_i_active: false,
      current_round: null,
      weapons_used: { call_teammate: false, eliminate: false, hint: false },
    },
  };
}

function renderPlay() {
  return render(
    <MemoryRouter initialEntries={['/team-arena/ABC123?side=a']}>
      <Routes>
        <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
        <Route path="/team-arena" element={<div>多人對抗賽入口頁</div>} />
        <Route path="/game-hub" element={<div>遊戲區首頁</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentTeamArenaPlay result screen exit buttons (#3771)', () => {
  it('shows 再玩一場 and 回遊戲區 buttons on the result screen (previously had none)', async () => {
    mockState = endedState();
    renderPlay();
    await screen.findByText('比賽結束');
    expect(screen.getByRole('button', { name: '再玩一場' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '回遊戲區' })).toBeTruthy();
  });

  it('再玩一場 navigates to /team-arena', async () => {
    mockState = endedState();
    const { user } = await (async () => {
      const utils = renderPlay();
      await screen.findByText('比賽結束');
      const { default: userEventModule } = await import('@testing-library/user-event');
      return { user: userEventModule.setup(), ...utils };
    })();
    await user.click(screen.getByRole('button', { name: '再玩一場' }));
    expect(await screen.findByText('多人對抗賽入口頁')).toBeTruthy();
  });

  it('回遊戲區 navigates to /game-hub', async () => {
    mockState = endedState();
    const { user } = await (async () => {
      const utils = renderPlay();
      await screen.findByText('比賽結束');
      const { default: userEventModule } = await import('@testing-library/user-event');
      return { user: userEventModule.setup(), ...utils };
    })();
    await user.click(screen.getByRole('button', { name: '回遊戲區' }));
    expect(await screen.findByText('遊戲區首頁')).toBeTruthy();
  });
});

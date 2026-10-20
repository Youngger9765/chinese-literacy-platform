/**
 * #3632 staging QA 2026-10-21: a fast correct answer topples a tower in one
 * hit (80 + speed bonus vs 100 HP), and the page then played ONLY the tower
 * collapse — a full match showed zero attack animations. Every hit must play
 * a random attack first; the collapse follows it.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, act } from '@testing-library/react';
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

// 甲隊 has destroyed 3 of 乙隊's towers (乙隊.towers_destroyed = 3); 甲隊
// itself is untouched (甲隊.towers_destroyed = 0). This is the exact
// shape from the real staging match the team lead reviewed.
function playingState() {
  return {
    code: 'ABC123',
    status: 'playing',
    turn_no: 5,
    state_version: 9,
    story: { key: null, team_labels: ['甲隊', '乙隊'], intro: '', background_art: null, energy_bar_label: '', result_copy: { win: '', lose: '', draw: '' } },
    team_size: 3,
    is_host: true,
    showdown: true,
    sides: {
      a: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
      b: { seated: 3, team_size: 3, towers_destroyed: 3, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
    },
    own_match: {
      my_side: 'a',
      match_status: 'active',
      winner: null,
      am_i_active: false,
      current_round: { turn_no: 5, called_for_help: false },
      weapons_used: { call_teammate: false, eliminate: false, hint: false },
    },
  };
}

function endedState() {
  return { ...playingState(), status: 'ended', own_match: { ...playingState().own_match, match_status: 'ended', winner: 'a' } };
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


function withB(towers: number, hp: number) {
  const s = playingState() as ReturnType<typeof playingState>;
  return { ...s, state_version: s.state_version + towers * 10 + (100 - hp), sides: { ...s.sides, b: { ...s.sides.b, towers_destroyed: towers, current_hp: hp } } };
}

describe('StudentTeamArenaPlay attack animation on every hit', () => {
  it('plays an attack (not just the collapse) when a hit topples a tower, then the collapse', async () => {
    mockState = withB(0, 100);
    const view = renderPlay();
    await screen.findByTestId('side-bar-乙隊');
    mockState = withB(1, 100);
    view.rerender(
      <MemoryRouter initialEntries={['/team-arena/ABC123?side=a']}>
        <Routes>
          <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
        </Routes>
      </MemoryRouter>,
    );
    const bar = screen.getByTestId('side-bar-乙隊');
    const attack = await within(bar).findByTestId('attack-animation');
    expect(attack.getAttribute('data-variant')).toBeTruthy();
    expect(within(bar).queryByTestId('tower-collapse-animation')).toBeNull();
    act(() => {
      fireEvent.animationEnd(attack);
    });
    expect(await within(bar).findByTestId('tower-collapse-animation', {}, { timeout: 2500 })).toBeTruthy();
  });

  it('plays an attack on a hit that only lowers HP', async () => {
    mockState = withB(0, 100);
    const view = renderPlay();
    await screen.findByTestId('side-bar-乙隊');
    mockState = withB(0, 40);
    view.rerender(
      <MemoryRouter initialEntries={['/team-arena/ABC123?side=a']}>
        <Routes>
          <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
        </Routes>
      </MemoryRouter>,
    );
    const bar = screen.getByTestId('side-bar-乙隊');
    expect(await within(bar).findByTestId('attack-animation')).toBeTruthy();
  });
});

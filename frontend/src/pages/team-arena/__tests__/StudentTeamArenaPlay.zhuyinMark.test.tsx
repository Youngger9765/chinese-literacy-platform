/**
 * v2 restoration of the #3652 regression lock (critic review on the v2
 * rewrite flagged that deleting the v1-shaped test with no replacement
 * dropped this lock entirely): a 注音 question's stem is a whole
 * sentence, so without a mark the student cannot tell which character is
 * being asked. The active player's play screen must mark
 * `current_round.extra.target_index`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, name: '小明' }, token: 'fake-token', isAuthenticated: true, isLoading: false }),
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
    getTeamArenaResult: vi.fn(() => new Promise(() => {})),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

function stateWith(extra: { target_index: number } | null) {
  return {
    code: 'ABC123',
    status: 'playing',
    turn_no: 0,
    state_version: 3,
    story: { key: null, team_labels: ['甲隊', '乙隊'], intro: '', background_art: null, energy_bar_label: '', result_copy: { win: '', lose: '', draw: '' } },
    team_size: 2,
    is_host: false,
    showdown: false,
    sides: {
      a: { seated: 2, team_size: 2, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
      b: { seated: 2, team_size: 2, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
    },
    own_match: {
      my_side: 'a',
      match_status: 'active',
      winner: null,
      am_i_active: true,
      current_round: {
        turn_no: 0,
        stem: '男孩叫正太。',
        extra,
        options: [
          { key: 'A', text: 'ㄊㄞˋ' },
          { key: 'B', text: 'ㄊㄞ˙' },
          { key: 'C', text: 'ㄊㄨㄛˋ' },
        ],
        reading_seconds: 0,
        answer_seconds: 30,
        revealed: false,
        hint_text: null,
        call_teammate_active: false,
        suggestions: [],
      },
      weapons_used: { call_teammate: false, eliminate: false, hint: false },
    },
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

describe('StudentTeamArenaPlay marks the asked 注音 character (#3652, restored for v2)', () => {
  it('marks stem[target_index]', async () => {
    mockState = stateWith({ target_index: 4 });
    renderPlay();
    const mark = await screen.findByTestId('stem-target');
    expect(mark.textContent).toBe('太');
  });

  it('renders the plain stem when there is no target', async () => {
    mockState = stateWith(null);
    renderPlay();
    expect(await screen.findByText('男孩叫正太。')).toBeTruthy();
    expect(screen.queryByTestId('stem-target')).toBeNull();
  });
});

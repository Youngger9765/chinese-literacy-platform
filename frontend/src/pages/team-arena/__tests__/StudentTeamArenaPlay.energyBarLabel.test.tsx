/**
 * #4054 (staging QA 逐步驗收): "塔下方進度條沒有標示（是目前那座塔的血
 * 量）". The backend has carried a themed caption for this exact bar since
 * #3772 (`story.energy_bar_label`, e.g. 書頁亮度／軍糧／墨量 depending on
 * the story pack) but `SideBar` never rendered it — the HP bar sat there
 * with no caption at all. Locks that the bar now shows that label, inside
 * each team's own panel.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    getTeamArenaResult: vi.fn(() => new Promise(() => {})),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

function playingState() {
  return {
    code: 'ABC123',
    status: 'playing',
    turn_no: 5,
    state_version: 9,
    story: {
      key: 'myth',
      team_labels: ['探書隊', '尋光隊'],
      intro: '',
      background_art: null,
      energy_bar_label: '書頁亮度',
      result_copy: { win: '', lose: '', draw: '' },
    },
    team_size: 3,
    is_host: true,
    showdown: false,
    turn_started_at: null,
    server_now: '2026-11-14T00:00:00Z',
    sides: {
      a: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 80, base_destroyed: false, match_status: 'active', winner: null, members: [] },
      b: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
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

function renderPlay() {
  return render(
    <MemoryRouter initialEntries={['/team-arena/ABC123?side=a']}>
      <Routes>
        <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentTeamArenaPlay HP bar caption (#4054)', () => {
  it('labels the progress bar with the story\'s own energy_bar_label, in both side panels', async () => {
    mockState = playingState();
    renderPlay();
    const a = await screen.findByTestId('side-bar-探書隊');
    const b = screen.getByTestId('side-bar-尋光隊');
    expect(within(a).getByText('書頁亮度')).toBeTruthy();
    expect(within(b).getByText('書頁亮度')).toBeTruthy();
  });
});

/**
 * #4054 (staging QA 逐步驗收): "結算畫面看不出誰贏 —— 兩隊都顯示「已打倒
 * 對方 3 座塔／我方剩 0 座塔」，只能靠故事文字猜。伺服器其實知道勝方（甲
 * 隊主堡被攻破），要明確標出哪隊贏". Each SideBar only ever printed the
 * tower counts; the one win/lose/draw line that DID exist was framed
 * entirely from the viewer's own perspective ("你們的...讀懂了") with no
 * literal team name, so a reader had to infer who won from narrative
 * flavor text rather than being told outright. Locks that a single,
 * unambiguous banner — read from the SERVER's own `winner` field, never
 * re-derived client-side from tower counts — names the winning team by
 * its actual label (or says 平手), and that it says the exact same thing
 * regardless of which side is viewing.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, name: '武士1' }, token: 'fake-token', isAuthenticated: true, isLoading: false }),
}));

let mockState: unknown = null;
let resultPayload: unknown = null;
vi.mock('../../../components/team-arena/useTeamArenaPoll', () => ({
  useTeamArenaPoll: () => ({ state: mockState, error: null, loading: false }),
}));

vi.mock('../../../services/teamArenaApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/teamArenaApi')>('../../../services/teamArenaApi');
  return {
    ...actual,
    getTeamArenaState: vi.fn(() => new Promise(() => {})),
    joinTeamArenaSession: vi.fn(() => Promise.resolve({ code: 'ABC123', status: 'playing' })),
    getTeamArenaResult: vi.fn(() => Promise.resolve(resultPayload)),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

const THEMED_STORY = {
  key: 'myth',
  team_labels: ['探書隊', '尋光隊'] as [string, string],
  intro: '',
  background_art: null,
  energy_bar_label: '書頁亮度',
  result_copy: {
    win: '你們的書頁率先變得清晰，這段故事由你們讀懂了！',
    lose: '迷霧還沒散去，下一段故事換你們挑戰',
    draw: '兩隊同時讀懂了這段故事，迷霧一起散去了',
  },
};

function endedState(mySide: 'a' | 'b', winner: 'a' | 'b' | 'draw') {
  return {
    code: 'ABC123',
    status: 'ended',
    turn_no: 5,
    state_version: 9,
    story: THEMED_STORY,
    team_size: 2,
    is_host: true,
    showdown: false,
    turn_started_at: null,
    server_now: '2026-11-14T00:00:00Z',
    sides: {
      a: { seated: 2, team_size: 2, towers_destroyed: winner === 'a' ? 0 : 3, current_hp: 0, base_destroyed: winner === 'b', match_status: 'ended', winner, members: [] },
      b: { seated: 2, team_size: 2, towers_destroyed: winner === 'b' ? 0 : 3, current_hp: 0, base_destroyed: winner === 'a', match_status: 'ended', winner, members: [] },
    },
    own_match: {
      my_side: mySide,
      match_status: 'ended',
      winner,
      am_i_active: false,
      current_round: null,
      weapons_used: { call_teammate: false, eliminate: false, hint: false },
    },
  };
}

function resultFor(winner: 'a' | 'b' | 'draw') {
  return {
    sides: {
      a: { towers_destroyed: winner === 'a' ? 0 : 3, base_destroyed: winner === 'b', match_status: 'ended', winner },
      b: { towers_destroyed: winner === 'b' ? 0 : 3, base_destroyed: winner === 'a', match_status: 'ended', winner },
    },
    players: {
      a: [{ student_id: 1, display_name: '武士1', highlight: '完整參與了這場比賽' }],
      b: [{ student_id: 4, display_name: '武士4', highlight: '完整參與了這場比賽' }],
    },
    me: { my_side: 'a', highlight: '完整參與了這場比賽' },
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

describe('StudentTeamArenaPlay result screen names the winning team (#4054)', () => {
  it('shows an unambiguous "<team label> 獲勝" banner for the winning side (not just tower counts)', async () => {
    mockState = endedState('a', 'a');
    resultPayload = resultFor('a');
    renderPlay();
    await screen.findByText('比賽結束');
    const banner = await screen.findByTestId('winner-banner');
    expect(banner.textContent).toContain('探書隊');
    expect(banner.textContent).toContain('獲勝');
  });

  it('shows the SAME winner banner text to the LOSING side\'s own viewer — not left to guess from tower counts', async () => {
    mockState = endedState('b', 'a');
    resultPayload = resultFor('a');
    renderPlay();
    await screen.findByText('比賽結束');
    const banner = await screen.findByTestId('winner-banner');
    // The losing viewer must still be told explicitly who actually won.
    expect(banner.textContent).toContain('探書隊');
    expect(banner.textContent).toContain('獲勝');
  });

  it('shows 平手 for a real draw, not a team name', async () => {
    mockState = endedState('a', 'draw');
    resultPayload = resultFor('draw');
    renderPlay();
    await screen.findByText('比賽結束');
    const banner = await screen.findByTestId('winner-banner');
    expect(banner.textContent).toContain('平手');
  });

  it('uses the SERVER winner field even before /result has resolved (derived from own_match.winner, never re-computed from tower counts)', async () => {
    mockState = endedState('a', 'b');
    resultPayload = new Promise(() => {}); // never resolves — banner must still work from state alone
    renderPlay();
    await screen.findByText('比賽結束');
    const banner = await screen.findByTestId('winner-banner');
    expect(banner.textContent).toContain('尋光隊');
    expect(banner.textContent).toContain('獲勝');
  });
});

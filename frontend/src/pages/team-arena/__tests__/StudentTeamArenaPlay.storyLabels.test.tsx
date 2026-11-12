/**
 * #3772 (game-academy audit r2, P1-1): the backend already carries a full
 * themed narrative (`state.story.team_labels`, `.result_copy`) — e.g.
 * 探書隊／尋光隊 instead of the generic 甲隊／乙隊, and a per-outcome
 * sentence like "兩隊同時讀懂了這段故事，迷霧一起散去了" for a draw — but
 * the screen only ever showed the generic placeholder text, never this
 * backend data. Locks that the lobby, in-game top bar, and the result
 * screen all read from `state.story` instead of hardcoding 甲隊／乙隊 and
 * a generic win/lose/draw sentence.
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
    getTeamArenaResult: vi.fn(() =>
      Promise.resolve({
        sides: {
          a: { towers_destroyed: 1, base_destroyed: false, match_status: 'ended', winner: 'draw' },
          b: { towers_destroyed: 1, base_destroyed: false, match_status: 'ended', winner: 'draw' },
        },
        players: {
          a: [{ student_id: 1, display_name: '武士1', highlight: '完整參與了這場比賽' }],
          b: [{ student_id: 4, display_name: '武士4', highlight: '完整參與了這場比賽' }],
        },
        me: { my_side: 'a', highlight: '完整參與了這場比賽' },
      }),
    ),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

// 探書隊／尋光隊 — the themed labels the backend actually sends when a
// story pack is active (StoryPack.faction_labels, projected by
// services/team_arena/story_adapter.py). NEVER null/empty per that
// adapter's own contract (even its own exception-fallback path still
// returns two real strings, 青隊/橙隊) — so the frontend needs no "甲隊/
// 乙隊" fallback of its own at all, it should just always read this field.
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

function baseState() {
  return {
    code: 'ABC123',
    turn_no: 5,
    state_version: 9,
    story: THEMED_STORY,
    team_size: 2,
    is_host: true,
    showdown: false,
    sides: {
      a: { seated: 2, team_size: 2, towers_destroyed: 1, current_hp: 50, base_destroyed: false, match_status: 'active', winner: null, members: [] },
      b: { seated: 2, team_size: 2, towers_destroyed: 1, current_hp: 50, base_destroyed: false, match_status: 'active', winner: null, members: [] },
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

function lobbyState() {
  return { ...baseState(), status: 'lobby' };
}

function playingState() {
  return { ...baseState(), status: 'playing' };
}

function endedState() {
  return {
    ...baseState(),
    status: 'ended',
    own_match: { ...baseState().own_match, match_status: 'ended', winner: 'draw' },
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

describe('StudentTeamArenaPlay uses backend story copy (#3772)', () => {
  it('lobby screen shows the themed team labels, not generic 甲隊/乙隊', async () => {
    mockState = lobbyState();
    renderPlay();
    await screen.findByText('探書隊');
    expect(screen.getByText('尋光隊')).toBeTruthy();
    expect(screen.queryByText('甲隊')).toBeNull();
    expect(screen.queryByText('乙隊')).toBeNull();
  });

  it('in-game top bar shows the themed team labels', async () => {
    mockState = playingState();
    renderPlay();
    const a = await screen.findByTestId('side-bar-探書隊');
    const b = screen.getByTestId('side-bar-尋光隊');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
  });

  it('result screen shows the themed team labels AND the custom draw copy, not the generic "平手"', async () => {
    mockState = endedState();
    renderPlay();
    await screen.findByText('比賽結束');
    expect(screen.getByText('兩隊同時讀懂了這段故事，迷霧一起散去了')).toBeTruthy();
    const ra = screen.getByTestId('result-side-a');
    const rb = screen.getByTestId('result-side-b');
    expect(within(ra).getByText('探書隊')).toBeTruthy();
    expect(within(rb).getByText('尋光隊')).toBeTruthy();
    expect(screen.queryByText('平手')).toBeNull();
  });
});

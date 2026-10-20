/**
 * TDD regression lock — tower-count label semantics (team-lead review of
 * #3655 staging screenshots, 2026-10-20).
 *
 * The bug: the old label `{sides[side].towers_destroyed}/{TOWER_COUNT} 座塔`
 * is ambiguous. `sides[side].towers_destroyed` is actually how many of
 * THAT side's OWN towers have fallen (damage taken BY that side) -- so
 * "甲隊 0/3 座塔" when 甲隊 players personally destroyed 3 of the
 * OPPONENT's towers (and each shows the highlight "打倒了一座塔") reads
 * as if 甲隊 accomplished nothing. Every reader of the real screenshot
 * read it backwards.
 *
 * The fix must show BOTH numbers, unambiguously worded, for both the
 * in-game top bar and the end screen:
 *   - "已打倒對方 N 座塔" (offense -- towers THIS side has knocked down,
 *     which is the OTHER side's towers_destroyed)
 *   - "我方剩 N 座塔" (defense -- towers this side has left, i.e.
 *     TOWER_COUNT - thisSide.towers_destroyed)
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

describe('StudentTeamArenaPlay tower-count label (in-game top bar)', () => {
  it('shows an unambiguous "knocked down" count for the side that is winning, not the raw towers_destroyed', async () => {
    mockState = playingState();
    renderPlay();
    // 甲隊 personally knocked down 3 of 乙隊's towers -- the panel labelled
    // 甲隊 must say it destroyed 3, NOT show a bare "0/3" next to 甲隊.
    const a = await screen.findByTestId('side-bar-甲隊');
    expect(within(a).getByText('已打倒對方 3 座塔')).toBeTruthy();
    // 甲隊 itself has taken no damage -- all 3 of its own towers remain.
    expect(within(a).getByText('我方剩 3 座塔')).toBeTruthy();
  });

  it('shows the losing side correctly: 0 destroyed, 0 remaining', async () => {
    mockState = playingState();
    renderPlay();
    const b = await screen.findByTestId('side-bar-乙隊');
    expect(within(b).getByText('已打倒對方 0 座塔')).toBeTruthy();
    expect(within(b).getByText('我方剩 0 座塔')).toBeTruthy();
  });

  it('never renders the old ambiguous "N/3 座塔" format', async () => {
    mockState = playingState();
    renderPlay();
    await screen.findByText('甲隊');
    expect(screen.queryByText(/^\d\/3 座塔$/)).toBeNull();
  });
});

describe('StudentTeamArenaPlay tower-count label (end screen)', () => {
  it('uses the same unambiguous wording on the result screen', async () => {
    mockState = endedState();
    renderPlay();
    await screen.findByText('比賽結束');
    const ra = await screen.findByTestId('result-side-a');
    const rb = screen.getByTestId('result-side-b');
    expect(within(ra).getByText('已打倒對方 3 座塔')).toBeTruthy();
    expect(within(ra).getByText('我方剩 3 座塔')).toBeTruthy();
    expect(within(rb).getByText('已打倒對方 0 座塔')).toBeTruthy();
    expect(within(rb).getByText('我方剩 0 座塔')).toBeTruthy();
    expect(screen.queryByText(/^\d\/3 座塔$/)).toBeNull();
  });
});

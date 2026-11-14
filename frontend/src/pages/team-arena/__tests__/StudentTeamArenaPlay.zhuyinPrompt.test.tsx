/**
 * #4054 (staging QA 逐步驗收): "注音題只有一句話加底線字，沒有「這個字怎
 * 麼唸？」之類的提問". The underline/bold mark (#3652) tells a student
 * WHICH character is being asked about, but nothing ever says WHAT the
 * question actually is — a child seeing an underlined character with no
 * accompanying question has to infer the task. Locks that a short prompt
 * line appears whenever the round carries a 注音 target (the same
 * `extra.target_index` signal `StemWithTarget` already uses — there is no
 * separate `source_module` field on the wire to key off of instead), and
 * that it is absent for non-注音 questions (no target_index at all).
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
    turn_started_at: null,
    server_now: '2026-11-14T00:00:00Z',
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

describe('StudentTeamArenaPlay 注音 question prompt line (#4054)', () => {
  it('shows "這個字怎麼唸？" when the round carries a 注音 target', async () => {
    mockState = stateWith({ target_index: 4 });
    renderPlay();
    await screen.findByTestId('stem-target');
    expect(screen.getByText('這個字怎麼唸？')).toBeTruthy();
  });

  it('does not show it for a non-注音 question (no target_index)', async () => {
    mockState = stateWith(null);
    renderPlay();
    await screen.findByText('男孩叫正太。');
    expect(screen.queryByText('這個字怎麼唸？')).toBeNull();
  });
});

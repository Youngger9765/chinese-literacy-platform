/**
 * TDD for StudentTeamArenaPlay's weapons UI — PRD §0 v2 改版 F/G/H/I/J.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, name: '小明' }, token: 'fake-token', isAuthenticated: true, isLoading: false }),
}));

let mockState: unknown = null;
vi.mock('../../../components/team-arena/useTeamArenaPoll', () => ({
  useTeamArenaPoll: () => ({ state: mockState, error: null, loading: false }),
}));

const submitTeamArenaWeaponMock = vi.fn(() => Promise.resolve({ status: 'ok', weapon: 'hint' }));

vi.mock('../../../services/teamArenaApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/teamArenaApi')>('../../../services/teamArenaApi');
  return {
    ...actual,
    getTeamArenaState: vi.fn(() => new Promise(() => {})),
    joinTeamArenaSession: vi.fn(() => Promise.resolve({ code: 'ABC123', status: 'playing' })),
    submitTeamArenaWeapon: (...args: unknown[]) => submitTeamArenaWeaponMock(...(args as [])),
    getTeamArenaResult: vi.fn(() => new Promise(() => {})),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

function baseState(overrides: { weaponsUsed?: Partial<Record<string, boolean>>; callTeammateActive?: boolean; suggestions?: unknown[] } = {}) {
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
        options: [
          { key: 'A', text: 'ㄊㄞˋ' },
          { key: 'B', text: 'ㄊㄞ˙' },
          { key: 'C', text: 'ㄊㄨㄛˋ' },
        ],
        reading_seconds: 0,
        answer_seconds: 30,
        revealed: false,
        hint_text: null,
        call_teammate_active: overrides.callTeammateActive ?? false,
        suggestions: overrides.suggestions ?? [],
      },
      weapons_used: { call_teammate: false, eliminate: false, hint: false, ...overrides.weaponsUsed },
    },
  };
}

function renderPlay() {
  // `?side=a` routes through the resolved joinTeamArenaSession mock
  // immediately; the bare-link membership-probe path calls
  // getTeamArenaState, which these tests deliberately leave pending (it
  // is covered by a dedicated test elsewhere) -- using the side-param
  // entry keeps this file focused on the weapons UI itself.
  return render(
    <MemoryRouter initialEntries={['/team-arena/ABC123?side=a']}>
      <Routes>
        <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentTeamArenaPlay weapons UI', () => {
  beforeEach(() => {
    submitTeamArenaWeaponMock.mockClear();
  });

  it('shows all three weapon buttons for the active player', async () => {
    mockState = baseState();
    renderPlay();
    await screen.findByText('呼叫隊友');
    expect(screen.getByText('刪減法')).toBeTruthy();
    expect(screen.getByText('看提示')).toBeTruthy();
  });

  it('clicking a weapon calls submitTeamArenaWeapon with the right weapon key', async () => {
    mockState = baseState();
    renderPlay();
    const hintBtn = await screen.findByText('看提示');
    fireEvent.click(hintBtn);
    await waitFor(() => expect(submitTeamArenaWeaponMock).toHaveBeenCalledWith('fake-token', 'ABC123', 'hint'));
  });

  it('a used weapon button is disabled, and ONLY that one (not the other two)', async () => {
    // Mutation-style regression lock (critic review): a wrong
    // implementation that disables ALL weapon buttons whenever ANY one has
    // been used (e.g. `Object.values(weaponsUsed).some(Boolean)` instead of
    // `weaponsUsed[w]`) must fail this test.
    mockState = baseState({ weaponsUsed: { hint: true } });
    renderPlay();
    const hintBtn = await screen.findByText('看提示');
    expect(hintBtn.closest('button')?.disabled).toBe(true);
    expect(screen.getByText('呼叫隊友').closest('button')?.disabled).toBe(false);
    expect(screen.getByText('刪減法').closest('button')?.disabled).toBe(false);
  });

  it('刪減法 is disabled (greyed out) when the question has only 2 options, PRD rule I', async () => {
    mockState = baseState();
    (mockState as { own_match: { current_round: { options: unknown[] } } }).own_match.current_round.options = [
      { key: 'A', text: 'ㄊㄞˋ' },
      { key: 'B', text: 'ㄊㄞ˙' },
    ];
    renderPlay();
    const eliminateBtn = await screen.findByText('刪減法');
    expect(eliminateBtn.closest('button')?.disabled).toBe(true);
    // The other two weapons are unaffected by option count.
    expect(screen.getByText('看提示').closest('button')?.disabled).toBe(false);
  });

  it('刪減法 stays enabled with 3+ options', async () => {
    mockState = baseState(); // baseState() already has 3 options
    renderPlay();
    const eliminateBtn = await screen.findByText('刪減法');
    expect(eliminateBtn.closest('button')?.disabled).toBe(false);
  });

  it('shows the suggestions panel once 呼叫隊友 is active', async () => {
    mockState = baseState({
      callTeammateActive: true,
      suggestions: [{ student_id: 99, display_name: '小華', choice_key: 'A' }],
    });
    renderPlay();
    await screen.findByText('隊友建議');
    expect(screen.getByText(/小華/)).toBeTruthy();
  });

  it('shows the 決戰時刻 banner when state.showdown is true', async () => {
    mockState = { ...baseState(), showdown: true };
    renderPlay();
    expect(await screen.findByTestId('showdown-banner')).toBeTruthy();
  });

  it('does not show the showdown banner otherwise', async () => {
    mockState = baseState();
    renderPlay();
    await screen.findByText('呼叫隊友');
    expect(screen.queryByTestId('showdown-banner')).toBeNull();
  });
});

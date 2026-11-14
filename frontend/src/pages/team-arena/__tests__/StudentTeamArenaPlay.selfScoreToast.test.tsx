/**
 * #4054 (staging QA 逐步驗收): "自己打倒的塔，提示說「隊友打倒了一座
 * 塔！」—— 前端只比對前後塔數，不知道是誰打的". The #3778 toast
 * (TeammateActionToast) always says 「隊友」 whenever the VIEWER's own side
 * topples an enemy tower, even when the viewer themselves was the active
 * player who just answered correctly — misattributing the viewer's own
 * action to an unnamed teammate. Locks that when the viewer IS the active
 * member for that side's round (`own_match.am_i_active`), the toast
 * credits "you", not "隊友" — while the existing #3778 bench-teammate case
 * (`am_i_active: false`, in the sibling teammateToast test file) must
 * still say 隊友 and is NOT touched by this fix.
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
    getTeamArenaResult: vi.fn(() => new Promise(() => {})),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

function playingState(amIActive: boolean) {
  return {
    code: 'ABC123',
    status: 'playing',
    turn_no: 5,
    state_version: 9,
    story: { key: null, team_labels: ['甲隊', '乙隊'], intro: '', background_art: null, energy_bar_label: '', result_copy: { win: '', lose: '', draw: '' } },
    team_size: 3,
    is_host: true,
    showdown: false,
    turn_started_at: null,
    server_now: '2026-11-14T00:00:00Z',
    sides: {
      a: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
      b: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
    },
    own_match: {
      my_side: 'a',
      match_status: 'active',
      winner: null,
      am_i_active: amIActive,
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

function rerenderSame(view: ReturnType<typeof renderPlay>) {
  view.rerender(
    <MemoryRouter initialEntries={['/team-arena/ABC123?side=a']}>
      <Routes>
        <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentTeamArenaPlay credits the actual answerer for a tower kill (#4054)', () => {
  it('says "你" (not 隊友) when the VIEWER is the active member who just scored for their own side', async () => {
    mockState = playingState(true);
    const view = renderPlay();
    await screen.findByTestId('side-bar-乙隊');

    const s = playingState(true);
    mockState = { ...s, state_version: 10, sides: { ...s.sides, b: { ...s.sides.b, towers_destroyed: 1 } } };
    rerenderSame(view);

    const toast = await screen.findByTestId('teammate-action-toast');
    expect(toast.textContent).toContain('你');
    expect(toast.textContent).not.toContain('隊友');
    expect(toast.className).toContain('bg-success');
  });

  it('still says 隊友 when the viewer is NOT the active member (bench teammate) — #3778 unchanged', async () => {
    mockState = playingState(false);
    const view = renderPlay();
    await screen.findByTestId('side-bar-乙隊');

    const s = playingState(false);
    mockState = { ...s, state_version: 10, sides: { ...s.sides, b: { ...s.sides.b, towers_destroyed: 1 } } };
    rerenderSame(view);

    const toast = await screen.findByTestId('teammate-action-toast');
    expect(toast.textContent).toContain('隊友');
  });
});

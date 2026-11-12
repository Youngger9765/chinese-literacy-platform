/**
 * #3778 (game-academy audit r2, P2-1): "一位隊友答對、打倒一座塔，另一位
 * 隊友看到的畫面只有進度條安靜地變化...沒有任何提示「隊友剛剛做了什麼」".
 * The SideBar attack/collapse animation already plays on the panel that
 * TOOK the damage (PRD §0 v2 rule N — every viewer sees it from public
 * data), but nothing names it out loud as "your team's doing". Locks that
 * an explicit toast appears, framed from the VIEWER's own side (my_side),
 * when their team topples an enemy tower/base — not just a silent bar.
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

function playingState() {
  return {
    code: 'ABC123',
    status: 'playing',
    turn_no: 5,
    state_version: 9,
    story: { key: null, team_labels: ['甲隊', '乙隊'], intro: '', background_art: null, energy_bar_label: '', result_copy: { win: '', lose: '', draw: '' } },
    team_size: 3,
    is_host: true,
    showdown: false,
    sides: {
      a: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
      b: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
    },
    // am_i_active: false — this viewer is a BENCH teammate, not the one
    // who just answered. The whole point of this ticket is that the
    // bystander teammate gets the same notification.
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

function rerenderSame(view: ReturnType<typeof renderPlay>) {
  view.rerender(
    <MemoryRouter initialEntries={['/team-arena/ABC123?side=a']}>
      <Routes>
        <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentTeamArenaPlay teammate action toast (#3778)', () => {
  it('a bench teammate (am_i_active=false) sees a celebratory toast when their OWN side (a) topples an enemy (b) tower', async () => {
    mockState = playingState();
    const view = renderPlay();
    await screen.findByTestId('side-bar-乙隊');

    const s = playingState();
    mockState = { ...s, state_version: 10, sides: { ...s.sides, b: { ...s.sides.b, towers_destroyed: 1 } } };
    rerenderSame(view);

    const toast = await screen.findByTestId('teammate-action-toast');
    expect(toast.textContent).toContain('隊友');
    expect(toast.className).toContain('bg-success');
  });

  it('shows a different (non-celebratory) toast when the VIEWER\'S OWN side (a) loses a tower', async () => {
    mockState = playingState();
    const view = renderPlay();
    await screen.findByTestId('side-bar-甲隊');

    const s = playingState();
    mockState = { ...s, state_version: 10, sides: { ...s.sides, a: { ...s.sides.a, towers_destroyed: 1 } } };
    rerenderSame(view);

    const toast = await screen.findByTestId('teammate-action-toast');
    expect(toast.className).not.toContain('bg-success');
  });

  it('a mere HP chip-damage tick (no tower/base change) does not spam a toast', async () => {
    mockState = playingState();
    const view = renderPlay();
    await screen.findByTestId('side-bar-乙隊');

    const s = playingState();
    mockState = { ...s, state_version: 10, sides: { ...s.sides, b: { ...s.sides.b, current_hp: 70 } } };
    rerenderSame(view);

    expect(screen.queryByTestId('teammate-action-toast')).toBeNull();
  });
});

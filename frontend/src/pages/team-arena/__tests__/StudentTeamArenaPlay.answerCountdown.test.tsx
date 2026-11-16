/**
 * #4054 (staging QA 逐步驗收): "作答畫面沒有倒數計時". Every other game
 * mode shows a countdown once the answer window opens (live_quiz's
 * CountdownBar, PRD §12); team-arena's answer screen had none at all —
 * neither for the active player nor for a summoned (呼叫隊友) teammate.
 * This reuses the SAME server-authoritative `CountdownBar` component
 * live_quiz already has (not a new client-timer implementation), fed by
 * the two new fields this ticket added to `/state`
 * (`turn_started_at`/`server_now`) plus the already-existing
 * `reading_seconds`/`answer_seconds` on the round. Locks it shows for
 * BOTH roles once options are visible, and NOT during the reading phase
 * (before options open — that's a different screen, out of scope here).
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

function baseState() {
  return {
    code: 'ABC123',
    status: 'playing',
    turn_no: 0,
    state_version: 3,
    story: { key: null, team_labels: ['甲隊', '乙隊'], intro: '', background_art: null, energy_bar_label: '', result_copy: { win: '', lose: '', draw: '' } },
    team_size: 2,
    is_host: false,
    showdown: false,
    turn_started_at: '2026-11-14T00:00:00.000Z',
    server_now: '2026-11-14T00:00:06.000Z',
    sides: {
      a: { seated: 2, team_size: 2, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
      b: { seated: 2, team_size: 2, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
    },
  };
}

function activeAnsweringState() {
  return {
    ...baseState(),
    own_match: {
      my_side: 'a',
      match_status: 'active',
      winner: null,
      am_i_active: true,
      current_round: {
        turn_no: 0,
        stem: '男孩叫正太。',
        extra: null,
        options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
        reading_seconds: 5,
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

function readingPhaseState() {
  const s = activeAnsweringState();
  return { ...s, own_match: { ...s.own_match, current_round: { ...s.own_match.current_round, options: null } } };
}

function calledForHelpAnsweringState() {
  return {
    ...baseState(),
    own_match: {
      my_side: 'a',
      match_status: 'active',
      winner: null,
      am_i_active: false,
      current_round: {
        turn_no: 0,
        called_for_help: true,
        stem: '男孩叫正太。',
        extra: null,
        options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
        reading_seconds: 5,
        answer_seconds: 30,
        revealed: false,
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

describe('StudentTeamArenaPlay answer-screen countdown (#4054)', () => {
  it('shows a countdown for the active player once options are visible', async () => {
    mockState = activeAnsweringState();
    renderPlay();
    await screen.findByText('男孩叫正太。');
    expect(await screen.findByRole('progressbar', { name: '作答倒數' })).toBeTruthy();
  });

  it('does NOT show a countdown during the reading phase (options not yet open)', async () => {
    mockState = readingPhaseState();
    renderPlay();
    await screen.findByText('請先仔細讀題目，稍後選項才會出現');
    expect(screen.queryByRole('progressbar', { name: '作答倒數' })).toBeNull();
  });

  it('shows a countdown for a summoned (呼叫隊友) teammate\'s suggestion screen too', async () => {
    mockState = calledForHelpAnsweringState();
    renderPlay();
    await screen.findByText('男孩叫正太。');
    expect(await screen.findByRole('progressbar', { name: '作答倒數' })).toBeTruthy();
  });
});

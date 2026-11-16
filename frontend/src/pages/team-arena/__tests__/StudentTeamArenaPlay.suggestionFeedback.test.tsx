/**
 * #4054 (staging QA 逐步驗收): "被呼叫的隊友點建議答案後沒反應 —— 按鈕沒
 * 有選取狀態、沒有「已送出」，失敗也不提示（`StudentTeamArenaPlay.tsx` 的
 * `handleSuggest` 吞掉錯誤），孩子會一直重複點". Locks three things for a
 * summoned (呼叫隊友) teammate's suggestion screen:
 *   1. clicking an option visibly selects it and shows 已送出
 *   2. the picker then locks (no more clicks register as a new choice)
 *   3. a failed submission surfaces a child-friendly error message AND
 *      un-locks the picker so the child can actually retry — instead of
 *      silently doing nothing, which is what caused the repeated tapping.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, name: '武士1' }, token: 'fake-token', isAuthenticated: true, isLoading: false }),
}));

let mockState: unknown = null;
vi.mock('../../../components/team-arena/useTeamArenaPoll', () => ({
  useTeamArenaPoll: () => ({ state: mockState, error: null, loading: false }),
}));

let suggestionShouldFail = false;
const submitTeamArenaSuggestion = vi.fn(async () => {
  if (suggestionShouldFail) {
    const { TeamArenaApiError } = await vi.importActual<typeof import('../../../services/teamArenaApi')>(
      '../../../services/teamArenaApi',
    );
    throw new TeamArenaApiError('網路不穩，請再試一次', 500);
  }
  return { status: 'ok' };
});

vi.mock('../../../services/teamArenaApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/teamArenaApi')>('../../../services/teamArenaApi');
  return {
    ...actual,
    getTeamArenaState: vi.fn(() => new Promise(() => {})),
    joinTeamArenaSession: vi.fn(() => Promise.resolve({ code: 'ABC123', status: 'playing' })),
    getTeamArenaResult: vi.fn(() => new Promise(() => {})),
    submitTeamArenaSuggestion: (...args: Parameters<typeof submitTeamArenaSuggestion>) =>
      submitTeamArenaSuggestion(...args),
  };
});

import StudentTeamArenaPlay from '../StudentTeamArenaPlay';

function calledForHelpState() {
  return {
    code: 'ABC123',
    status: 'playing',
    turn_no: 5,
    state_version: 9,
    story: { key: null, team_labels: ['甲隊', '乙隊'], intro: '', background_art: null, energy_bar_label: '', result_copy: { win: '', lose: '', draw: '' } },
    team_size: 3,
    is_host: false,
    showdown: false,
    turn_started_at: '2026-11-14T00:00:00Z',
    server_now: '2026-11-14T00:00:01Z',
    sides: {
      a: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
      b: { seated: 3, team_size: 3, towers_destroyed: 0, current_hp: 100, base_destroyed: false, match_status: 'active', winner: null, members: [] },
    },
    own_match: {
      my_side: 'a',
      match_status: 'active',
      winner: null,
      am_i_active: false,
      current_round: {
        turn_no: 5,
        called_for_help: true,
        stem: '「好」的注音是？',
        extra: null,
        options: [
          { key: 'A', text: 'ㄏㄠˇ' },
          { key: 'B', text: 'ㄏㄠˋ' },
        ],
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

describe('StudentTeamArenaPlay 呼叫隊友 suggestion click feedback (#4054)', () => {
  beforeEach(() => {
    suggestionShouldFail = false;
    submitTeamArenaSuggestion.mockClear();
  });

  it('shows the clicked option as selected with 已送出, and locks the picker', async () => {
    mockState = calledForHelpState();
    renderPlay();
    const { default: userEventModule } = await import('@testing-library/user-event');
    const user = userEventModule.setup();

    const buttonA = await screen.findByRole('button', { name: /ㄏㄠˇ/ });
    await user.click(buttonA);

    expect(submitTeamArenaSuggestion).toHaveBeenCalledWith('fake-token', 'ABC123', 'A');
    expect(await screen.findByText('已送出')).toBeTruthy();
    expect(buttonA).toHaveTextContent('已送出');

    const buttonB = screen.getByRole('button', { name: /ㄏㄠˋ/ });
    expect(buttonB).toBeDisabled();
    expect(buttonA).toBeDisabled();
  });

  it('shows a child-friendly error and unlocks the picker when the submission fails', async () => {
    suggestionShouldFail = true;
    mockState = calledForHelpState();
    renderPlay();
    const { default: userEventModule } = await import('@testing-library/user-event');
    const user = userEventModule.setup();

    const buttonA = await screen.findByRole('button', { name: /ㄏㄠˇ/ });
    await user.click(buttonA);

    expect(await screen.findByText('網路不穩，請再試一次')).toBeTruthy();
    // Must NOT be stuck showing 已送出 for a submission that actually failed.
    expect(screen.queryByText('已送出')).toBeNull();
    // And the child must be able to try again — buttons re-enabled.
    expect(screen.getByRole('button', { name: /ㄏㄠˇ/ })).not.toBeDisabled();
  });
});

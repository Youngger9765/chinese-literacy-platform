/**
 * #3771 (game-academy audit r2, P0-2): the 課堂搶答 "ended" screen (both
 * teacher-ended-early and natural completion) had ZERO interactive
 * elements — a student could only leave via the browser's own back
 * button. Locks that GameResultActions wires in a working 回遊戲區 (no
 * "再玩一場" here — a student never starts their own round, the teacher
 * does, so there is nothing to replay).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import type { LiveQuizState } from '../../../services/liveQuizApi';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'fake-token', user: { name: '小明' } }),
}));

vi.mock('../../../services/liveQuizApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/liveQuizApi')>(
    '../../../services/liveQuizApi',
  );
  return {
    ...actual,
    joinLiveQuizGame: vi.fn().mockResolvedValue({ player_id: 1, display_name: '小明', game_code: '123456' }),
    isValidLiveQuizCode: () => true,
  };
});

let mockState: LiveQuizState | null = null;
vi.mock('../../../components/live-quiz/useLiveQuizPoll', () => ({
  useLiveQuizPoll: () => ({ state: mockState, error: null, loading: false }),
}));

// eslint-disable-next-line import/first -- intentional, imported after mocks
import StudentLiveQuizPlay from '../StudentLiveQuizPlay';

function endedState(overrides: Partial<LiveQuizState>): LiveQuizState {
  return {
    code: '123456',
    status: 'ended',
    version: 1,
    server_now: new Date().toISOString(),
    round_index: 2,
    rounds_total: 3,
    question_started_at: null,
    answer_open_at: null,
    reading_seconds: 2,
    round: null,
    answered_count: 7,
    players_count: 7,
    is_host: false,
    classroom_id: null,
    settings: {
      seconds: 30, question_count_mode: 'all', shuffle: false,
      show_leaderboard_after_each: true, double_points_last: false,
      streak_bonus: false, practice_mode: false, source_modules: ['comprehension'],
    },
    ended_reason: null,
    ended_by_host: false,
    your_player: {
      player_id: 1, display_name: '小明', eligible: true, correct_count: 2,
      last_answer_correct: true, last_answer_points: 900,
    },
    ...overrides,
  } as LiveQuizState;
}

function renderAt(state: LiveQuizState) {
  mockState = state;
  return render(
    <MemoryRouter initialEntries={['/live/123456']}>
      <Routes>
        <Route path="/live/:code" element={<StudentLiveQuizPlay />} />
        <Route path="/game-hub" element={<div>遊戲區首頁</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentLiveQuizPlay ended screen exit button (#3771)', () => {
  it('shows a 回遊戲區 button when the game ends naturally (previously had none)', async () => {
    renderAt(endedState({ ended_by_host: false }));
    expect(await screen.findByText('課堂搶答結束！')).toBeTruthy();
    expect(screen.getByRole('button', { name: '回遊戲區' })).toBeTruthy();
    // No "再玩一場" here — a student never starts their own round.
    expect(screen.queryByRole('button', { name: /再玩/ })).toBeNull();
  });

  it('also shows it when the teacher ends the game early', async () => {
    renderAt(endedState({ ended_by_host: true }));
    expect(await screen.findByText('老師提前結束了這場課堂搶答')).toBeTruthy();
    expect(screen.getByRole('button', { name: '回遊戲區' })).toBeTruthy();
  });

  it('回遊戲區 navigates to /game-hub', async () => {
    renderAt(endedState({ ended_by_host: false }));
    await screen.findByText('課堂搶答結束！');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '回遊戲區' }));
    expect(await screen.findByText('遊戲區首頁')).toBeTruthy();
  });
});

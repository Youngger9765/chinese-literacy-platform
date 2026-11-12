/**
 * StudentLiveQuizPlay — issue #3631 P0 #4: this round's points + running
 * total always show at reveal (non-practice); top 5 see their actual rank,
 * everyone else sees a signed 前進/後退 delta, never "第 N 名".
 */
import { render, screen } from '@testing-library/react';
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

// Imported after mocks so they take effect.
// eslint-disable-next-line import/first -- intentional, see comment above
import StudentLiveQuizPlay from '../StudentLiveQuizPlay';

function baseState(overrides: Partial<LiveQuizState>): LiveQuizState {
  return {
    code: '123456',
    status: 'reveal',
    version: 1,
    server_now: new Date().toISOString(),
    round_index: 0,
    rounds_total: 3,
    question_started_at: null,
    answer_open_at: null,
    reading_seconds: 2,
    round: {
      item_id: 'x', source_module: 'comprehension', lesson_uid: 'L1', lesson_title: 't',
      stem: '題幹', correct_key: 'A', seconds: 30, reading_seconds: 2,
    },
    answered_count: 5,
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
      player_id: 1, display_name: '小明', eligible: true, correct_count: 1,
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
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentLiveQuizPlay — reveal rank/score (P0 #4)', () => {
  it('top 5 player sees total score and their actual rank number', async () => {
    renderAt(
      baseState({
        your_player: {
          player_id: 1, display_name: '小明', eligible: true, correct_count: 1,
          last_answer_correct: true, last_answer_points: 900, total_score: 1800, rank: 2,
        },
      }),
    );
    expect(await screen.findByText('總分 1800 分')).toBeTruthy();
    expect(screen.getByText('目前第 2 名')).toBeTruthy();
  });

  it('6th place or lower sees an "advanced N places" delta, never "第 N 名"', async () => {
    renderAt(
      baseState({
        your_player: {
          player_id: 1, display_name: '小明', eligible: true, correct_count: 1,
          last_answer_correct: true, last_answer_points: 900, total_score: 900, rank_delta: 2,
        },
      }),
    );
    expect(await screen.findByText('這題前進了 2 名')).toBeTruthy();
    expect(screen.queryByText(/^目前第 \d+ 名$/)).toBeNull();
    expect(screen.queryByText(/第 \d+ 名/)).toBeNull();
  });

  it('shows "retreated" wording for a negative delta', async () => {
    renderAt(
      baseState({
        your_player: {
          player_id: 1, display_name: '小明', eligible: true, correct_count: 1,
          last_answer_correct: false, total_score: 400, rank_delta: -3,
        },
      }),
    );
    expect(await screen.findByText('這題後退了 3 名')).toBeTruthy();
  });

  it('shows nothing rank-related in practice mode (fields absent from the API response)', async () => {
    renderAt(
      baseState({
        your_player: {
          player_id: 1, display_name: '小明', eligible: true, correct_count: 1,
          last_answer_correct: true,
          // total_score/rank/rank_delta/last_answer_points all absent, as
          // the backend omits them under practice_mode.
        },
      }),
    );
    // Wait for the join effect to resolve and the real reveal UI to render
    // (the correct/wrong feedback is always present) before asserting
    // absence — otherwise "not found" could just mean "still loading".
    expect(await screen.findByText('答對了！')).toBeTruthy();
    expect(screen.queryByText(/總分/)).toBeNull();
    expect(screen.queryByText(/名/)).toBeNull();
  });
});

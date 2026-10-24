/**
 * StudentLiveQuizPlay — lobby integration (#3761, replacing round-2's
 * plain-text lobby with `LiveQuizWaitingRoom`). Component-level behavior
 * (peer wall sizing, 怎麼玩 steps, etc.) is covered by
 * `LiveQuizWaitingRoom.test.tsx`; this file only checks the wiring: the
 * component renders with the real `state.players_count`, and the 離開
 * button's confirm dialog gates the navigate-away.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// eslint-disable-next-line import/first -- intentional, imported after mocks
import StudentLiveQuizPlay from '../StudentLiveQuizPlay';

function lobbyState(overrides: Partial<LiveQuizState> = {}): LiveQuizState {
  return {
    code: '123456',
    status: 'lobby',
    version: 1,
    server_now: new Date().toISOString(),
    round_index: -1,
    rounds_total: 5,
    question_started_at: null,
    answer_open_at: null,
    reading_seconds: 2,
    round: null,
    answered_count: null,
    players_count: 3,
    is_host: false,
    classroom_id: null,
    settings: {
      seconds: 30, question_count_mode: 'all', shuffle: false,
      show_leaderboard_after_each: true, double_points_last: false,
      streak_bonus: false, practice_mode: false, source_modules: ['comprehension'],
    },
    ended_reason: null,
    ended_by_host: false,
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

describe('StudentLiveQuizPlay — lobby (#3761 LiveQuizWaitingRoom integration)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('renders LiveQuizWaitingRoom with the real players_count from state', async () => {
    renderAt(lobbyState({ players_count: 5 }));
    expect(await screen.findByText('目前已有 5 人加入')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '等待老師開始搶答' })).toBeTruthy();
  });

  it('離開 asks for confirmation; confirming navigates to /game-hub', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt(lobbyState());
    fireEvent.click(await screen.findByRole('button', { name: /離開/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/game-hub');
    confirmSpy.mockRestore();
  });

  it('離開 does NOT navigate when the confirm dialog is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAt(lobbyState());
    fireEvent.click(await screen.findByRole('button', { name: /離開/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('question 畫面不顯示 lobby 專屬的等待室內容（不干擾既有畫面）', async () => {
    renderAt(
      lobbyState({
        status: 'question',
        round_index: 0,
        round: {
          item_id: 'x', source_module: 'comprehension', lesson_uid: 'L1', lesson_title: 't',
          stem: '題幹', correct_key: 'A', seconds: 30, reading_seconds: 2,
          options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }],
        },
        your_player: { player_id: 1, display_name: '小明', eligible: true, correct_count: 0 },
      }),
    );
    expect(screen.queryByText('等待老師開始搶答')).toBeNull();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

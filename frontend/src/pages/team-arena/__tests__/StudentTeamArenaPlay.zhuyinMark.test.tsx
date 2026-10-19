/**
 * #3632 staging QA: a 注音 question's stem is a whole sentence, so without a
 * mark the student cannot tell which character is being asked (the same gap
 * #3642 closed for 課堂搶答). The student's play screen must mark
 * `payload.extra.target_index`.
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
  useTeamArenaPoll: () => ({ state: mockState, error: null }),
  default: () => ({ state: mockState, error: null }),
}));

vi.mock('../../../services/teamArenaApi', async () => {
  const actual = await vi.importActual<typeof import('../../../services/teamArenaApi')>('../../../services/teamArenaApi');
  return {
    ...actual,
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
    story: null,
    own_match: {
      towers_down: { zhuyin: 0, vocab_definitions: 0, vocab_application: 0, comprehension: 0 },
      base_hits: 0,
      score: 0,
      match_status: 'playing',
      winner: null,
      my_lane: 'zhuyin',
      my_side: 'a',
      am_i_active: true,
      current_round: {
        turn_no: 0,
        lane: 'zhuyin',
        active_student_id: 7,
        payload: {
          stem: '男孩叫正太。',
          options: [{ key: 'A', text: 'ㄊㄞˋ' }, { key: 'B', text: 'ㄊㄞ˙' }],
          extra,
        },
        reading_seconds: 0,
        answer_seconds: 30,
        revealed: false,
      },
    },
  };
}

function renderPlay() {
  return render(
    <MemoryRouter initialEntries={['/team-arena/ABC123']}>
      <Routes>
        <Route path="/team-arena/:code" element={<StudentTeamArenaPlay />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StudentTeamArenaPlay marks the asked 注音 character (#3632)', () => {
  it('marks stem[target_index]', async () => {
    mockState = stateWith({ target_index: 4 });
    renderPlay();
    const mark = await screen.findByTestId('stem-target');
    expect(mark.textContent).toBe('太');
  });

  it('renders the plain stem when there is no target', async () => {
    mockState = stateWith(null);
    renderPlay();
    expect(await screen.findByText('男孩叫正太。')).toBeTruthy();
    expect(screen.queryByTestId('stem-target')).toBeNull();
  });
});

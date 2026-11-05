/**
 * TDD tests for the 遊戲區「島嶼探索」卡 (#3780 D1, PRD §5.7/§6)。
 *
 * 鎖住的驗收條件：
 * - 卡片顯示「已佔領 N 座島」，N 跟我的群島頁用同一個規則（is_occupied 計數）
 * - 卡片顯示「閱讀寶貝已遇見 M 隻」（#3780 reading-babies phase 2，取代 v1
 *   文字寶貝）
 * - 點擊導去 /student/archipelago
 * - 資料還沒回來時顯示 loading 字樣，不是空白或崩潰
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

const user = { id: 9, roles: [{ role_name: 'student' }] };
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'fake-token', user }),
}));

vi.mock('../../../services/learning/session', async () => {
  const actual = await vi.importActual<typeof import('../../../services/learning/session')>(
    '../../../services/learning/session',
  );
  return { ...actual, fetchMyEnrolledClassrooms: vi.fn().mockResolvedValue({ total: 0, student_grade: 4, classrooms: [] }) };
});

const getStudentProgressMock = vi.fn();
vi.mock('../../../services/progressApi', () => ({
  getStudentProgress: (...args: unknown[]) => getStudentProgressMock(...args),
}));

const fetchReadingBabyAtlasMock = vi.fn();
vi.mock('../../../services/readingBabyApi', () => ({
  fetchReadingBabyAtlas: (...args: unknown[]) => fetchReadingBabyAtlasMock(...args),
}));

function atlasWithOwned(owned: number, total: number) {
  const babies = Array.from({ length: total }, (_, i) => ({
    lesson_uid: `L${i}`, title: `lesson ${i}`, ability_family: 'A', ability_family_name: 'x',
    stage: i < owned ? 'basic' as const : 'not_encountered' as const,
    assessable_total: 1, assessable_passed: 0, progress_ratio: 0, fragments_count: 0, next_step: null, all_cleared: false,
  }));
  return { student_id: 9, total_lessons: total, total_fragments: 0, babies };
}

import StudentGameHubPage from '../StudentGameHubPage';

function progressWithOccupied(occupiedCountVal: number, totalTexts: number) {
  const texts = Array.from({ length: totalTexts }, (_, i) => ({
    story_slug: String(i), story_title: null, latest_session_id: i, status: 'in_progress',
    steps: [], completion_pct: 0, overall_score: null, accuracy: null, started_at: 'x', completed_at: null,
    next_step: { action: 'continue', step: null, reason: '' },
    steps_completed: [], has_session: true,
    is_occupied: i < occupiedCountVal, stations_done: 1, stations_total: 5,
  }));
  return { student_id: 9, texts_attempted: totalTexts, texts_completed: 0, average_score: null, texts };
}

beforeEach(() => {
  mockNavigate.mockReset();
  getStudentProgressMock.mockReset();
  fetchReadingBabyAtlasMock.mockReset();
});

describe('StudentGameHubPage — 島嶼探索卡 (#3780 D1)', () => {
  it('顯示已佔領島數（跟 is_occupied 計數一致）與閱讀寶貝已遇見數', async () => {
    getStudentProgressMock.mockResolvedValue(progressWithOccupied(2, 5));
    fetchReadingBabyAtlasMock.mockResolvedValue(atlasWithOwned(4, 100));

    render(<StudentGameHubPage />);
    await waitFor(() => expect(screen.getByText(/已佔領 2 座島/)).toBeTruthy());
    expect(screen.getByText(/閱讀寶貝已遇見 4 隻/)).toBeTruthy();
  });

  it('點擊卡片導去 /student/archipelago', async () => {
    getStudentProgressMock.mockResolvedValue(progressWithOccupied(0, 3));
    fetchReadingBabyAtlasMock.mockResolvedValue(atlasWithOwned(0, 100));

    render(<StudentGameHubPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '島嶼探索' })).toBeTruthy());

    act(() => { fireEvent.click(screen.getByRole('button', { name: '島嶼探索' })); });
    expect(mockNavigate).toHaveBeenCalledWith('/student/archipelago');
  });

  it('資料還沒回來時顯示 loading 字樣，不是空白或崩潰', () => {
    getStudentProgressMock.mockReturnValue(new Promise(() => {})); // never resolves
    fetchReadingBabyAtlasMock.mockReturnValue(new Promise(() => {}));

    render(<StudentGameHubPage />);
    expect(screen.getByText(/已佔領島嶼載入中|載入中/)).toBeTruthy();
  });

  it('0 座島、0 隻寶貝（全新學生）顯示 0，不是空白或 undefined', async () => {
    getStudentProgressMock.mockResolvedValue(progressWithOccupied(0, 0));
    fetchReadingBabyAtlasMock.mockResolvedValue(atlasWithOwned(0, 100));

    render(<StudentGameHubPage />);
    await waitFor(() => expect(screen.getByText(/已佔領 0 座島/)).toBeTruthy());
    expect(screen.getByText(/閱讀寶貝已遇見 0 隻/)).toBeTruthy();
  });
});

/**
 * StudentGameHubPage — issue #3633 "遊戲化模式集中成一個「遊戲區」入口".
 *
 * One hub page replaces three scattered sidebar entries (我們班/課堂搶答/
 * PK 對戰) and finally gives 迷城密室 a way in — it has had a working page
 * at /escape-room since #3599 but NO sidebar entry at all, so students
 * could never reach it through navigation (the bug this issue exists to
 * fix). 五人對抗賽 has no feature yet, so its card is always disabled with
 * "即將推出".
 *
 * Locking rule is identical to the pre-#3633 sidebar (#3607): 跨班賽季 and
 * 課堂搶答 are locked ("老師尚未開啟") until ANY of the student's enrolled
 * classrooms has the corresponding flag on. PK 對戰 and 迷城密室 are never
 * classroom-gated (issue #3633 explicit: "AI PK、迷城密室不受班級開關限制").
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'fake-token' }),
}));

const { fetchMyEnrolledClassrooms } = vi.hoisted(() => ({
  fetchMyEnrolledClassrooms: vi.fn(),
}));
vi.mock('../../../services/learning/session', async () => {
  const actual = await vi.importActual<typeof import('../../../services/learning/session')>(
    '../../../services/learning/session',
  );
  return { ...actual, fetchMyEnrolledClassrooms };
});

import StudentGameHubPage from '../StudentGameHubPage';

function classroomsResponse(overrides: { league?: boolean; liveQuiz?: boolean }[]) {
  return {
    total: overrides.length,
    student_grade: 4,
    classrooms: overrides.map((o, idx) => ({
      id: idx + 1,
      name: `班級 ${idx + 1}`,
      grade: 4,
      teacher_id: 1,
      teacher_name: '老師',
      is_active: true,
      enrolled_at: '2026-01-01',
      pk_human: false,
      league: o.league ?? false,
      live_quiz: o.liveQuiz ?? false,
    })),
  };
}

beforeEach(() => {
  mockNavigate.mockReset();
  fetchMyEnrolledClassrooms.mockReset();
});

describe('<StudentGameHubPage> — always-present cards (#3633)', () => {
  it('renders one card per game mode, including 迷城密室 (the bug this issue fixes)', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    for (const label of ['跨班賽季', '課堂搶答', 'PK 對戰', '迷城密室', '五人對抗賽']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('五人對抗賽 is always disabled and shows 即將推出, regardless of classroom flags', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(
      classroomsResponse([{ league: true, liveQuiz: true }]),
    );
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    const btn = screen.getByRole('button', { name: /五人對抗賽/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText('即將推出')).toBeTruthy();
    fireEvent.click(btn);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('PK 對戰 and 迷城密室 are never locked, even with zero enrolled classrooms', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /PK 對戰/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /迷城密室/ })).not.toBeDisabled();
  });
});

describe('<StudentGameHubPage> — classroom-flag locking, all off / all on / mixed (#3633, same rule as #3607)', () => {
  it('all-off: 跨班賽季 and 課堂搶答 are both locked with 老師尚未開啟', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(
      classroomsResponse([{ league: false, liveQuiz: false }]),
    );
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /跨班賽季/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /課堂搶答/ })).toBeDisabled();
    expect(screen.getAllByText('老師尚未開啟')).toHaveLength(2);
  });

  it('all-on: both unlock', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(
      classroomsResponse([{ league: true, liveQuiz: true }]),
    );
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /跨班賽季/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /課堂搶答/ })).not.toBeDisabled();
  });

  it('mixed: league on in one classroom, live_quiz on in another — ANY-classroom rule unlocks both independently', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(
      classroomsResponse([{ league: true, liveQuiz: false }, { league: false, liveQuiz: true }]),
    );
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /跨班賽季/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /課堂搶答/ })).not.toBeDisabled();
  });

  it('mixed: only league on — 課堂搶答 stays locked', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(
      classroomsResponse([{ league: true, liveQuiz: false }]),
    );
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /跨班賽季/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /課堂搶答/ })).toBeDisabled();
  });
});

describe('<StudentGameHubPage> — navigation (#3633)', () => {
  it('clicking 迷城密室 navigates to /escape-room (the entry point that was missing)', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    fireEvent.click(screen.getByRole('button', { name: /迷城密室/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/escape-room');
  });

  it('clicking PK 對戰 navigates to /pk', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    fireEvent.click(screen.getByRole('button', { name: /PK 對戰/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/pk');
  });

  it('clicking an unlocked 跨班賽季 navigates to /student/our-class', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(
      classroomsResponse([{ league: true }]),
    );
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /跨班賽季/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/student/our-class');
  });

  it('clicking a locked 課堂搶答 does nothing', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /課堂搶答/ }));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('<StudentGameHubPage> — resilience (render smoke)', () => {
  it('does not throw when the enrollment fetch rejects (fail-safe: cards simply stay locked)', async () => {
    fetchMyEnrolledClassrooms.mockRejectedValue(new Error('network error'));
    expect(() => render(<StudentGameHubPage />)).not.toThrow();
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /跨班賽季/ })).toBeDisabled();
  });
});

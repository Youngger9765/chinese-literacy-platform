/**
 * StudentGameHubPage — issue #3633 "遊戲化模式集中成一個「遊戲區」入口".
 *
 * One hub page replaces three scattered sidebar entries (我們班/課堂搶答/
 * PK 對戰) and finally gives 迷城密室 a way in — it has had a working page
 * at /escape-room since #3599 but NO sidebar entry at all, so students
 * could never reach it through navigation (the bug this issue exists to
 * fix).
 *
 * Locking rule (unchanged by #3632 v2): 跨班賽季 and 課堂搶答 are locked
 * ("老師尚未開啟") until ANY of the student's enrolled classrooms has the
 * corresponding flag on. PK 對戰、迷城密室、and 多人對抗賽 (issue #3632 v2:
 * "拿掉班級開關") are never classroom-gated.
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
    for (const label of ['跨班賽季', '課堂搶答', 'PK 對戰', '迷城密室', '多人對抗賽']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('PK 對戰、迷城密室、多人對抗賽 are never locked, even with zero enrolled classrooms (#3632 v2)', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /PK 對戰/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /迷城密室/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /多人對抗賽/ })).not.toBeDisabled();
  });
});

describe('<StudentGameHubPage> — classroom-flag locking, 跨班賽季/課堂搶答 only (#3633)', () => {
  it('all-off: 跨班賽季、課堂搶答 are locked with 老師尚未開啟', async () => {
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

describe('<StudentGameHubPage> — navigation (#3633, extended #3632 v2)', () => {
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

  it('clicking 多人對抗賽 navigates to /team-arena, with zero enrolled classrooms (#3632 v2)', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /多人對抗賽/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/team-arena');
  });
});

describe('<StudentGameHubPage> — 自己玩／跟班上一起玩 sections (#3756)', () => {
  it('renders both section headings with their one-line explanation', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    expect(screen.getByRole('heading', { name: '自己玩' })).toBeTruthy();
    expect(screen.getByText('不用等任何人，現在就能開始')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '跟班上一起玩' })).toBeTruthy();
    expect(screen.getByText('要老師開始，或找同學一起')).toBeTruthy();
  });

  it('PK 對戰、迷城密室 are under 自己玩; 課堂搶答、多人對抗賽、跨班賽季 are under 跟班上一起玩', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());

    const selfSection = screen.getByRole('heading', { name: '自己玩' }).closest('section');
    const classSection = screen.getByRole('heading', { name: '跟班上一起玩' }).closest('section');
    expect(selfSection).toBeTruthy();
    expect(classSection).toBeTruthy();

    for (const label of ['PK 對戰', '迷城密室']) {
      expect(
        Array.from(selfSection!.querySelectorAll('button')).some((b) => b.textContent?.includes(label)),
      ).toBe(true);
    }
    for (const label of ['課堂搶答', '多人對抗賽', '跨班賽季']) {
      expect(
        Array.from(classSection!.querySelectorAll('button')).some((b) => b.textContent?.includes(label)),
      ).toBe(true);
    }
  });

  it('每張未鎖卡片都有開始條件徽章（隨時可玩／需要老師開始／找同學一起）', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(
      classroomsResponse([{ league: true, liveQuiz: true }]),
    );
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());

    expect(screen.getAllByText('隨時可玩')).toHaveLength(3); // PK 對戰、迷城密室、島嶼探索 (#3780 D1)
    expect(screen.getByText('找同學一起')).toBeTruthy(); // 多人對抗賽
    expect(screen.getAllByText('需要老師開始')).toHaveLength(2); // 課堂搶答、跨班賽季 (unlocked here)
  });

  it('a locked card shows 老師尚未開啟 instead of its start-condition badge (no stacking)', async () => {
    fetchMyEnrolledClassrooms.mockResolvedValue(classroomsResponse([]));
    render(<StudentGameHubPage />);
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());

    const liveQuizButton = screen.getByRole('button', { name: /課堂搶答/ });
    expect(liveQuizButton.textContent).toContain('老師尚未開啟');
    expect(liveQuizButton.textContent).not.toContain('需要老師開始');
  });
});

describe('<StudentGameHubPage> — resilience (render smoke)', () => {
  it('does not throw when the enrollment fetch rejects (fail-safe: classroom-gated cards simply stay locked)', async () => {
    fetchMyEnrolledClassrooms.mockRejectedValue(new Error('network error'));
    expect(() => render(<StudentGameHubPage />)).not.toThrow();
    await waitFor(() => expect(fetchMyEnrolledClassrooms).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /跨班賽季/ })).toBeDisabled();
    // 多人對抗賽 is never classroom-gated (#3632 v2) -- a failed enrollment
    // fetch must not accidentally lock it too.
    expect(screen.getByRole('button', { name: /多人對抗賽/ })).not.toBeDisabled();
  });
});

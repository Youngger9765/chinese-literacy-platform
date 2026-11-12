/**
 * 2026-10-16 UI redesign (#3554 follow-up): the most recent season's board
 * must render as a BattleHero automatically — not hidden behind a "查看
 * 排行榜" click like the MVP's plain list (PRD §12.2 decision #3). This
 * locks that behavior plus the chest-unlock hint so a future refactor
 * can't silently regress back to the click-to-reveal pattern.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TeacherLeaguePage from '../TeacherLeaguePage';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 1, name: '李老師' } }),
}));

vi.mock('../../../services/classroomApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/classroomApi')>()),
  listMyClassrooms: vi.fn(() =>
    Promise.resolve({
      items: [
        {
          id: 1, name: '三年甲班', teacher_id: 1, school_id: 1, grade: 3, created_at: '', student_count: 2,
          // issue #3607: league already enabled for this classroom — this
          // test is about the battle-hero render, not the feature-gate
          // prompt (that gets its own dedicated test file).
          league: true,
        },
      ],
      total: 1,
    }),
  ),
}));

vi.mock('../../../services/leagueApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/leagueApi')>()),
  listInvitations: vi.fn(() => Promise.resolve([])),
  listClassroomSeasons: vi.fn(() =>
    Promise.resolve([
      { season_id: 42, name: '跨班邀請賽：三年甲班 vs 五年乙班', game_start: '', game_end: '', is_finalized: false },
    ]),
  ),
  getSeasonBoard: vi.fn(() =>
    Promise.resolve({
      season_id: 42,
      season_name: '跨班邀請賽：三年甲班 vs 五年乙班',
      board: [
        {
          team_id: 1,
          classroom_id: 1,
          classroom_name: '三年甲班',
          grade: 3,
          roster_size: 2,
          participant_count: 1,
          average_points: 60,
          team_badge_earned: false,
          treasure_chest_eligible: true,
          badge_threshold: 120,
          treasure_chest_participants_needed: 0,
          rank: 1,
        },
        {
          team_id: 2,
          classroom_id: 2,
          classroom_name: '五年乙班',
          grade: 5,
          roster_size: 4,
          participant_count: 1,
          average_points: 30,
          team_badge_earned: false,
          treasure_chest_eligible: false,
          badge_threshold: 120,
          treasure_chest_participants_needed: 1,
          rank: 2,
        },
      ],
    }),
  ),
}));

describe('TeacherLeaguePage — battle hero renders automatically', () => {
  it('shows the season name, both classrooms, and the chest hint without any click', async () => {
    render(<TeacherLeaguePage />);

    expect(await screen.findByText('跨班邀請賽：三年甲班 vs 五年乙班')).toBeInTheDocument();
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getAllByText('三年甲班').length).toBeGreaterThan(0);
    expect(screen.getByText('五年乙班')).toBeInTheDocument();
    // Classroom B (1/4 participated) is not yet eligible -> gap hint shows.
    // chestHintText + participant count share one <p>, split across text
    // nodes by the " · " separator, so match on textContent not exact text.
    expect(
      screen.getByText((_, el) => el?.textContent === '還差 1 人就能解鎖神秘寶箱 · 全班 1/4 人已參與'),
    ).toBeInTheDocument();
    // Classroom A (viewer's own, 1/2 == eligible) -> unlocked hint shows.
    expect(
      screen.getByText((_, el) => el?.textContent === '全班已解鎖神秘寶箱！ · 全班 1/2 人已參與'),
    ).toBeInTheDocument();
    // Viewer's own classroom is tagged.
    expect(screen.getByText('我們班')).toBeInTheDocument();
  });
});

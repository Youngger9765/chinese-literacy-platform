/**
 * 2026-10-16 UI redesign (#3554 follow-up): students previously never saw
 * the opposing classroom at all on 我們班 — just their own two stat tiles.
 * Locks that the same BattleHero the teacher sees also renders here once
 * the season board loads.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudentOurClassPage from '../StudentOurClassPage';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 9, name: '小明' } }),
}));

vi.mock('../../../services/leagueApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/leagueApi')>()),
  getMyLeagueHistory: vi.fn(() =>
    Promise.resolve([
      {
        season_id: 42,
        season_name: '跨班邀請賽：三年甲班 vs 五年乙班',
        my_points: 20,
        my_lessons_counted: 2,
        individual_badge_earned: false,
        class_average_points: 60,
        class_badge_earned: false,
        participant_count: 1,
        roster_size: 2,
        badge_threshold: 120,
        treasure_chest_eligible: true,
        treasure_chest_participants_needed: 0,
      },
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

describe('StudentOurClassPage — battle hero shows the opposing classroom', () => {
  it('renders both classrooms and VS once the season board loads', async () => {
    render(<StudentOurClassPage />);
    expect(await screen.findByText('VS')).toBeInTheDocument();
    expect(screen.getAllByText('三年甲班').length).toBeGreaterThan(0);
    expect(screen.getByText('五年乙班')).toBeInTheDocument();
  });
});

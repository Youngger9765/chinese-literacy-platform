/**
 * #3615 class-level sweep: for EVERY builtin story pack, the student
 * 我們班 page and the shared BattleHero must show that pack's own chest
 * name / title / opening, and none of the other packs' wording (nor the old
 * hardcoded「神秘寶箱」) may leak in.
 *
 * Packs come from fixtures/builtinStoryPacks.json, which the backend test
 * tests/test_story_pack_frontend_fixture.py keeps equal to BUILTIN_PACKS.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { LeagueTheme } from '../../../types/leagueTheme';
import type { LeagueBoardRow } from '../../../services/leagueApi';
import builtinPacks from './fixtures/builtinStoryPacks.json';

const PACKS = builtinPacks as unknown as LeagueTheme[];

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token', user: { id: 9, name: '小明' } }),
}));

const mockHistory = vi.fn();
const mockBoard = vi.fn();
vi.mock('../../../services/leagueApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/leagueApi')>()),
  getMyLeagueHistory: (...a: unknown[]) => mockHistory(...a),
  getSeasonBoard: (...a: unknown[]) => mockBoard(...a),
}));

import StudentOurClassPage from '../../../pages/student/StudentOurClassPage';
import BattleHero from '../BattleHero';

const ROWS: [LeagueBoardRow, LeagueBoardRow] = [
  {
    team_id: 1, classroom_id: 1, classroom_name: '三年甲班', grade: 3, roster_size: 10,
    participant_count: 2, average_points: 40, team_badge_earned: false,
    treasure_chest_eligible: false, badge_threshold: 120, treasure_chest_participants_needed: 4, rank: 1,
  },
  {
    team_id: 2, classroom_id: 2, classroom_name: '五年乙班', grade: 5, roster_size: 10,
    participant_count: 6, average_points: 30, team_badge_earned: false,
    treasure_chest_eligible: true, badge_threshold: 120, treasure_chest_participants_needed: 0, rank: 2,
  },
];

function historyFor(theme: LeagueTheme) {
  return [
    {
      season_id: 42, season_name: '跨班邀請賽：三年甲班 vs 五年乙班', my_points: 20,
      my_lessons_counted: 2, individual_badge_earned: false, class_average_points: 40,
      class_badge_earned: false, participant_count: 2, roster_size: 10, badge_threshold: 120,
      treasure_chest_eligible: false, treasure_chest_participants_needed: 4, theme,
    },
  ];
}

function otherPacksWording(pack: LeagueTheme): string[] {
  const out: string[] = [];
  for (const other of PACKS) {
    if (other.key !== pack.key) {
      // A word another pack also uses legitimately is not a leak of THAT pack.
      if (other.chest.name !== pack.chest.name) out.push(other.chest.name);
      if (other.title !== pack.title) out.push(other.title);
    }
  }
  return out;
}

function expectOnlyThisPack(text: string, pack: LeagueTheme) {
  expect(text).toContain('還差 4 人就能解鎖' + pack.chest.name);
  expect(text).toContain('全班已解鎖' + pack.chest.name + '！');
  expect(text).not.toContain('神秘寶箱');
  for (const leak of otherPacksWording(pack)) {
    expect(text, 'leaked from another pack: ' + leak).not.toContain(leak);
  }
}

const visitedStudent: string[] = [];
const visitedHero: string[] = [];

describe('story pack sweep: every builtin pack drives its own wording, issue 3615', () => {
  beforeEach(() => {
    cleanup();
    mockHistory.mockReset();
    mockBoard.mockReset();
  });

  afterAll(() => {
    // Positive control: the sweep really iterated every builtin pack.
    expect(new Set(visitedStudent).size).toBe(5);
    expect(new Set(visitedHero).size).toBe(5);
  });

  it('fixture has all five builtin packs', () => {
    expect(PACKS.map((p) => p.key)).toEqual(['myth', 'tang-dynasty', 'song-dynasty', 'wuxia', 'detective']);
  });

  it.each(PACKS.map((p) => [p.key, p] as const))(
    'student page uses pack %s for chest, title and opening',
    async (_key, pack) => {
      visitedStudent.push(pack.key);
      mockHistory.mockResolvedValue(historyFor(pack));
      mockBoard.mockResolvedValue({ season_id: 42, season_name: '跨班邀請賽', board: ROWS, theme: pack });
      const { container } = render(<StudentOurClassPage />);
      await screen.findByText('VS');

      const story = await screen.findByTestId('student-story-intro');
      expect(within(story).getByText(pack.title)).toBeInTheDocument();
      for (const paragraph of pack.intro) {
        expect(within(story).getByText(paragraph)).toBeInTheDocument();
      }
      expectOnlyThisPack(container.textContent ?? '', pack);
    },
  );

  it.each(PACKS.map((p) => [p.key, p] as const))('BattleHero chest hint uses pack %s', (_key, pack) => {
    visitedHero.push(pack.key);
    const { container } = render(
      <BattleHero theme={pack} seasonName="賽季" rows={ROWS} viewerClassroomId={1} isFinalized={false} />,
    );
    expectOnlyThisPack(container.textContent ?? '', pack);
  });
});

describe('student page shows the story even if the board fails, issue 3615', () => {
  beforeEach(() => {
    cleanup();
    mockHistory.mockReset();
    mockBoard.mockReset();
  });

  it('title and opening come from the season theme, not only from BattleHero', async () => {
    const pack = PACKS[1];
    mockHistory.mockResolvedValue(historyFor(pack));
    mockBoard.mockRejectedValue(new Error('board down'));
    render(<StudentOurClassPage />);
    const story = await screen.findByTestId('student-story-intro');
    expect(within(story).getByText(pack.title)).toBeInTheDocument();
    expect(within(story).getByText(pack.intro[0])).toBeInTheDocument();
  });
});

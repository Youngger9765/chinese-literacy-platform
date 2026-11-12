import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME_FALLBACK,
  determineOutcome,
  pickMilestoneMessage,
  resultCopyFor,
} from '../leagueTheme';
import type { LeagueTheme } from '../../../types/leagueTheme';
import type { LeagueBoardRow } from '../../../services/leagueApi';

function makeTheme(overrides: Partial<LeagueTheme> = {}): LeagueTheme {
  return {
    schema_version: 1,
    key: 'test-theme',
    era: '測試',
    title: '測試賽',
    intro: ['測試簡介'],
    faction_labels: ['甲隊', '乙隊'],
    energy_bar_label: '測試量',
    milestones: [
      { ratio: 0.25, message: '剛起步' },
      { ratio: 0.5, message: '過半了' },
      { ratio: 1.0, message: '全滿了' },
    ],
    background_art: null,
    chest: { name: '測試寶箱', description: '測試描述', art: { kind: 'emoji', value: '📦' } },
    badges: [
      { key: 'individual_badge', name: '個人徽章', description: 'x', art: { kind: 'emoji', value: '⭐' } },
      { key: 'class_badge', name: '班級徽章', description: 'y', art: { kind: 'emoji', value: '🏅' } },
    ],
    result_copy: { win: '贏了', lose: '輸了', draw: '平手' },
    ...overrides,
  };
}

function makeRow(overrides: Partial<LeagueBoardRow> = {}): LeagueBoardRow {
  return {
    team_id: 1,
    classroom_id: 1,
    classroom_name: '班級A',
    grade: 4,
    roster_size: 10,
    participant_count: 5,
    average_points: 60,
    team_badge_earned: false,
    treasure_chest_eligible: false,
    badge_threshold: 120,
    treasure_chest_participants_needed: 1,
    rank: 1,
    ...overrides,
  };
}

describe('pickMilestoneMessage', () => {
  const theme = makeTheme();

  it('returns null at exactly zero progress', () => {
    expect(pickMilestoneMessage(theme, 0)).toBeNull();
  });

  it('returns null below the first milestone', () => {
    expect(pickMilestoneMessage(theme, 0.1)).toBeNull();
  });

  it('returns the first crossed milestone', () => {
    expect(pickMilestoneMessage(theme, 0.25)).toBe('剛起步');
  });

  it('returns the HIGHEST crossed milestone, not the first', () => {
    expect(pickMilestoneMessage(theme, 0.6)).toBe('過半了');
  });

  it('returns the final milestone at full progress', () => {
    expect(pickMilestoneMessage(theme, 1.0)).toBe('全滿了');
  });

  it('returns null for a theme with no milestones', () => {
    expect(pickMilestoneMessage(makeTheme({ milestones: [] }), 0.9)).toBeNull();
  });

  it('is defensive against non-finite progress', () => {
    expect(pickMilestoneMessage(theme, Number.NaN)).toBeNull();
    expect(pickMilestoneMessage(theme, -1)).toBeNull();
  });
});

describe('determineOutcome', () => {
  const theme = makeTheme();

  it('viewer on the left with higher points wins', () => {
    const rows: [LeagueBoardRow, LeagueBoardRow] = [
      makeRow({ classroom_id: 1, average_points: 80 }),
      makeRow({ classroom_id: 2, average_points: 40 }),
    ];
    expect(determineOutcome(rows, 1)).toBe('win');
    expect(resultCopyFor(theme, determineOutcome(rows, 1))).toBe('贏了');
  });

  it('viewer on the right with lower points loses', () => {
    const rows: [LeagueBoardRow, LeagueBoardRow] = [
      makeRow({ classroom_id: 1, average_points: 80 }),
      makeRow({ classroom_id: 2, average_points: 40 }),
    ];
    expect(determineOutcome(rows, 2)).toBe('lose');
  });

  it('equal points is a draw regardless of side', () => {
    const rows: [LeagueBoardRow, LeagueBoardRow] = [
      makeRow({ classroom_id: 1, average_points: 50 }),
      makeRow({ classroom_id: 2, average_points: 50 }),
    ];
    expect(determineOutcome(rows, 1)).toBe('draw');
    expect(determineOutcome(rows, 2)).toBe('draw');
  });

  it('falls back to the left team perspective when viewer is unknown (student view)', () => {
    const rows: [LeagueBoardRow, LeagueBoardRow] = [
      makeRow({ classroom_id: 1, average_points: 80 }),
      makeRow({ classroom_id: 2, average_points: 40 }),
    ];
    expect(determineOutcome(rows, null)).toBe('win');
  });

  it('a viewer classroom id that matches neither row still falls back to the left perspective', () => {
    const rows: [LeagueBoardRow, LeagueBoardRow] = [
      makeRow({ classroom_id: 1, average_points: 30 }),
      makeRow({ classroom_id: 2, average_points: 70 }),
    ];
    expect(determineOutcome(rows, 999)).toBe('lose');
  });
});

describe('DEFAULT_THEME_FALLBACK', () => {
  it('is a structurally valid-looking theme usable when the API response lacks one', () => {
    expect(DEFAULT_THEME_FALLBACK.badges).toHaveLength(2);
    expect(DEFAULT_THEME_FALLBACK.faction_labels).toHaveLength(2);
    expect(DEFAULT_THEME_FALLBACK.chest.name.length).toBeGreaterThan(0);
  });
});

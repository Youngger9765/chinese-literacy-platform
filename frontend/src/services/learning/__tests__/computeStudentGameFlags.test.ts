/**
 * computeStudentGameFlags — issue #3633 game-hub consolidation, extended by
 * issue #3632 to also compute the 五人對抗賽 (team_arena) unlock flag.
 *
 * This is the single "ANY enrolled classroom has it on" rule that used to
 * live inline inside Sidebar.tsx's own fetch effect (issue #3607). Moving
 * it here and testing it directly means StudentGameHubPage can reuse the
 * exact same rule instead of re-deriving it itself.
 */
import { describe, it, expect } from 'vitest';
import { computeStudentGameFlags, type StudentEnrolledClassroom } from '../session';

function classroom(overrides: Partial<StudentEnrolledClassroom> = {}): StudentEnrolledClassroom {
  return {
    id: 1,
    name: '測試班',
    grade: 4,
    teacher_id: 1,
    teacher_name: '老師',
    is_active: true,
    enrolled_at: '2026-01-01',
    pk_human: false,
    league: false,
    live_quiz: false,
    team_arena: false,
    ...overrides,
  };
}

describe('computeStudentGameFlags (#3633, extended #3632)', () => {
  it('returns all three false when there are no enrolled classrooms', () => {
    expect(computeStudentGameFlags([])).toEqual({ league: false, liveQuiz: false, teamArena: false });
  });

  it('returns all three false when every classroom has every flag off', () => {
    const classrooms = [classroom(), classroom({ id: 2 })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: false, liveQuiz: false, teamArena: false });
  });

  it('returns league=true when ANY classroom has league on, even if others do not', () => {
    const classrooms = [classroom({ league: false }), classroom({ id: 2, league: true })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: true, liveQuiz: false, teamArena: false });
  });

  it('returns liveQuiz=true when ANY classroom has live_quiz on', () => {
    const classrooms = [classroom({ live_quiz: false }), classroom({ id: 2, live_quiz: true })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: false, liveQuiz: true, teamArena: false });
  });

  it('returns teamArena=true when ANY classroom has team_arena on', () => {
    const classrooms = [classroom({ team_arena: false }), classroom({ id: 2, team_arena: true })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: false, liveQuiz: false, teamArena: true });
  });

  it('returns all three true when all three flags are on across different classrooms (mixed)', () => {
    const classrooms = [
      classroom({ league: true }),
      classroom({ id: 2, live_quiz: true }),
      classroom({ id: 3, team_arena: true }),
    ];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: true, liveQuiz: true, teamArena: true });
  });

  it('ignores pk_human — PK is never classroom-gated so this function has no opinion on it', () => {
    const classrooms = [classroom({ pk_human: true, league: false, live_quiz: false, team_arena: false })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: false, liveQuiz: false, teamArena: false });
  });
});

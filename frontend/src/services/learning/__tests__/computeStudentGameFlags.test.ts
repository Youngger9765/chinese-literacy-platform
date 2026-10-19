/**
 * computeStudentGameFlags — issue #3633 game-hub consolidation.
 *
 * This is the single "ANY enrolled classroom has it on" rule that used to
 * live inline inside Sidebar.tsx's own fetch effect (issue #3607). Moving
 * it here and testing it directly means StudentGameHubPage can reuse the
 * exact same rule instead of re-deriving `.some(c => c.league)` itself.
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
    ...overrides,
  };
}

describe('computeStudentGameFlags (#3633)', () => {
  it('returns both false when there are no enrolled classrooms', () => {
    expect(computeStudentGameFlags([])).toEqual({ league: false, liveQuiz: false });
  });

  it('returns both false when every classroom has both flags off', () => {
    const classrooms = [classroom(), classroom({ id: 2 })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: false, liveQuiz: false });
  });

  it('returns league=true when ANY classroom has league on, even if others do not', () => {
    const classrooms = [classroom({ league: false }), classroom({ id: 2, league: true })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: true, liveQuiz: false });
  });

  it('returns liveQuiz=true when ANY classroom has live_quiz on', () => {
    const classrooms = [classroom({ live_quiz: false }), classroom({ id: 2, live_quiz: true })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: false, liveQuiz: true });
  });

  it('returns both true when both flags are on across classrooms (mixed)', () => {
    const classrooms = [classroom({ league: true }), classroom({ id: 2, live_quiz: true })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: true, liveQuiz: true });
  });

  it('ignores pk_human — PK is never classroom-gated so this function has no opinion on it', () => {
    const classrooms = [classroom({ pk_human: true, league: false, live_quiz: false })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: false, liveQuiz: false });
  });
});

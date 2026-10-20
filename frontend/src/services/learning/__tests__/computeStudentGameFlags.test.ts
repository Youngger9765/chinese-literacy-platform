/**
 * computeStudentGameFlags — issue #3633 game-hub consolidation.
 *
 * This is the single "ANY enrolled classroom has it on" rule that used to
 * live inline inside Sidebar.tsx's own fetch effect (issue #3607). Moving
 * it here and testing it directly means StudentGameHubPage can reuse the
 * exact same rule instead of re-deriving it itself.
 *
 * 五人對抗賽 (team_arena, issue #3632) is NOT covered here as of its v2
 * rewrite (2026-10-20, PRD rule B: "拿掉班級開關") — v2 rooms are
 * classroom-independent, so there is no flag left for this function to
 * compute for it (see StudentGameHubPage.tsx, which unlocks that card
 * unconditionally, same as pk_human/escape-room).
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

  it('returns both false when every classroom has every flag off', () => {
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

  it('returns both true when both flags are on across different classrooms (mixed)', () => {
    const classrooms = [classroom({ league: true }), classroom({ id: 2, live_quiz: true })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: true, liveQuiz: true });
  });

  it('ignores pk_human — PK is never classroom-gated so this function has no opinion on it', () => {
    const classrooms = [classroom({ pk_human: true, league: false, live_quiz: false })];
    expect(computeStudentGameFlags(classrooms)).toEqual({ league: false, liveQuiz: false });
  });
});

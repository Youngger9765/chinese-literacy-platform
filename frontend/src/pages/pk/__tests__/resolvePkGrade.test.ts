import { describe, it, expect } from 'vitest';
import { resolveGradeForAiPk, PK_DEFAULT_GRADE_FALLBACK } from '../resolvePkGrade';

describe('resolveGradeForAiPk — #3602 B1', () => {
  it('prefers the active classroom grade when present', () => {
    const grade = resolveGradeForAiPk([{ grade: 3 }, { grade: 6 }], 6, 9);
    expect(grade).toBe(6);
  });

  it('falls back to any other classroom with a grade when the active one has none', () => {
    // This is the exact demo-student 小明 shape from staging QA: the
    // "active" classroom (id 8) had grade=null, but classroom id 5 had
    // grade=6 — AI PK must use that instead of blocking entirely.
    const grade = resolveGradeForAiPk([{ grade: null }, { grade: 6 }, { grade: null }, { grade: 3 }], null, null);
    expect(grade).toBe(6);
  });

  it('falls back to the student profile grade when no classroom has one', () => {
    const grade = resolveGradeForAiPk([{ grade: null }, { grade: null }], null, 7);
    expect(grade).toBe(7);
  });

  it('falls back to the default grade when nothing is known at all', () => {
    const grade = resolveGradeForAiPk([], null, null);
    expect(grade).toBe(PK_DEFAULT_GRADE_FALLBACK);
  });

  it('falls back to the default when classrooms are all gradeless and no profile grade', () => {
    const grade = resolveGradeForAiPk([{ grade: null }], null, null);
    expect(grade).toBe(PK_DEFAULT_GRADE_FALLBACK);
  });

  it('a custom default can be supplied', () => {
    const grade = resolveGradeForAiPk([], null, null, 5);
    expect(grade).toBe(5);
  });
});

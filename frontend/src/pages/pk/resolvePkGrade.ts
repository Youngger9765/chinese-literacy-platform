/**
 * resolvePkGrade — #3602 B1: AI PK (挑戰文學家) must work for every logged-in
 * student "regardless of class" (Young 2026-10-16). StudentPkEntry.tsx used
 * to pick ONE classroom (the first "active" one, or the first one at all)
 * and required THAT classroom to have a grade before it would let a student
 * see any PK button at all — a student enrolled in several classrooms where
 * the active one happened to have no grade set (demo student 小明: 4 classes,
 * the first active one had grade=null) got blocked entirely, even from AI PK,
 * which the backend's /api/pk/challenge-ai never required a classroom for in
 * the first place.
 *
 * This resolves a grade from the best signal available, in priority order:
 *   1. The classroom chosen for real-PK actions (找同學 PK / invite), if it
 *      has a grade — keeps AI PK's question pool consistent with whatever
 *      classroom context the student is already using for other PK actions.
 *   2. ANY other enrolled classroom that has a grade set.
 *   3. The student's own profile grade (StudentProfile.grade via the
 *      `student_grade` field on GET /api/classrooms/my-enrollments).
 *   4. A safe default. This case should be rare in practice — every
 *      classroom normally carries a grade and so does every student's
 *      profile — so it's a last resort, not the common path.
 */

/** 3-9 is the platform's grade range (see StudentProfile.grade's comment);
 * 4 is a defensible middle default when every other signal is unavailable. */
export const PK_DEFAULT_GRADE_FALLBACK = 4;

export interface PkClassroomGradeSignal {
  grade: number | null;
}

export function resolveGradeForAiPk(
  classrooms: PkClassroomGradeSignal[],
  activeClassroomGrade: number | null,
  studentGrade: number | null,
  defaultGrade: number = PK_DEFAULT_GRADE_FALLBACK,
): number {
  if (activeClassroomGrade != null) return activeClassroomGrade;
  const anyWithGrade = classrooms.find((c) => c.grade != null);
  if (anyWithGrade?.grade != null) return anyWithGrade.grade;
  if (studentGrade != null) return studentGrade;
  return defaultGrade;
}

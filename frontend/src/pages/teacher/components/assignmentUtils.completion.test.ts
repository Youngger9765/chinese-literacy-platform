import { describe, it, expect } from 'vitest';
import { completionCounts } from './assignmentUtils';

// 作業管理 showed 4/12 for a class of 10: the denominator was submission_count,
// which counts attempts (a student can attempt several times). The matrix and
// the assignment detail already use students (4/10). Reproduced on staging
// 2026-10-13: assigned_student_count 10, submitted_student_count 4,
// submission_count 12.
describe('completionCounts — students, not attempts', () => {
  it('uses submitted/assigned student counts when the API provides them', () => {
    expect(
      completionCounts({ completed_count: 4, submission_count: 12, submitted_student_count: 4, assigned_student_count: 10 } as never),
    ).toEqual({ done: 4, total: 10 });
  });

  it('falls back to the old fields only when the student counts are missing', () => {
    expect(completionCounts({ completed_count: 2, submission_count: 5 } as never)).toEqual({ done: 2, total: 5 });
  });
});

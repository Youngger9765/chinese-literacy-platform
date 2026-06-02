/**
 * Pure logic helpers extracted from AssignmentDetailPanel (Issue #1853).
 * No React imports — pure TS, fully testable without DOM.
 */
import type { StudentAttemptGroup, SubmissionResponse } from '../../services/assignmentApi';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GroupedStats {
  pending: number;
  submitted: number;
}

export interface GradeClickState {
  gradeInput: string;
  feedbackInput: string;
}

// ─── countGroupedStats ────────────────────────────────────────────────────────

/**
 * Count pending and submitted students from the grouped (per-student) view.
 * Uses latest_status to reflect the student's most recent attempt state.
 */
export function countGroupedStats(groups: StudentAttemptGroup[]): GroupedStats {
  let pending = 0;
  let submitted = 0;
  for (const g of groups) {
    if (g.latest_status === 'pending') pending++;
    else if (g.latest_status === 'submitted') submitted++;
  }
  return { pending, submitted };
}

// ─── validateScore ────────────────────────────────────────────────────────────

/**
 * Validate a raw score input string.
 * Returns null on success, or an error message string on failure.
 *
 * Rules:
 *  - empty string → null score → valid (teacher can save without a score)
 *  - non-numeric → error
 *  - score < 0 or score > 100 → error
 */
export function validateScore(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null; // no score is OK

  const score = parseFloat(trimmed);
  if (isNaN(score) || !isFinite(score) || score < 0 || score > 100) {
    return '分數需介於 0–100';
  }
  return null;
}

// ─── buildGradeClickState ─────────────────────────────────────────────────────

/**
 * Build the initial state when teacher clicks "批改" for a submission.
 * Pre-fills rounded score and existing feedback so teacher can edit.
 */
export function buildGradeClickState(sub: Pick<SubmissionResponse, 'score' | 'teacher_feedback'>): GradeClickState {
  return {
    gradeInput: sub.score != null ? String(Math.round(sub.score)) : '',
    feedbackInput: sub.teacher_feedback ?? '',
  };
}

// ─── filterSubmittedForBulk ───────────────────────────────────────────────────

/**
 * Returns only submissions whose status is 'submitted' (ungraded).
 * Used by BulkCommentPanel to determine which rows to grade.
 */
export function filterSubmittedForBulk(submissions: SubmissionResponse[]): SubmissionResponse[] {
  return submissions.filter((s) => s.status === 'submitted');
}

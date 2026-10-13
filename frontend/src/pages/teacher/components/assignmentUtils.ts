import { isPastDue } from '../../../utils/dueDate';
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function isOverdue(dueDateStr: string | null): boolean {
  return isPastDue(dueDateStr);
}

export function completionPercentage(completedCount: number, submissionCount: number): number {
  return submissionCount > 0 ? Math.round((completedCount / submissionCount) * 100) : 0;
}

/**
 * Completion in students, not attempts. submission_count counts attempts (one
 * student can try several times), so 作業管理 showed 4/12 for a class of 10.
 * Same fields AssignmentDetailPanel already uses (#1764).
 */
export function completionCounts(a: {
  completed_count: number;
  submission_count: number;
  submitted_student_count?: number | null;
  assigned_student_count?: number | null;
}): { done: number; total: number } {
  return {
    done: a.submitted_student_count ?? a.completed_count,
    total: a.assigned_student_count ?? a.submission_count,
  };
}

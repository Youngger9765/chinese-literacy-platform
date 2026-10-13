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

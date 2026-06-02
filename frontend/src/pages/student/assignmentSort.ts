/**
 * assignmentSort.ts — sorting helpers for MyAssignments list.
 * Extracted from MyAssignments.tsx (Issue #1881).
 */

import type { StudentAssignmentResponse } from '../../services/assignmentApi';

export type SortKey = 'newest' | 'due_asc' | 'score_desc';

export interface SortOption {
  key: SortKey;
  label: string;
  compareFn: (a: StudentAssignmentResponse, b: StudentAssignmentResponse) => number;
}

export const SORT_OPTIONS: SortOption[] = [
  {
    key: 'newest',
    label: '最新指派',
    compareFn: (a, b) => b.assignment_id - a.assignment_id,
  },
  {
    key: 'due_asc',
    label: '截止日期（由近到遠）',
    compareFn: (a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    },
  },
  {
    key: 'score_desc',
    label: '分數（高到低）',
    compareFn: (a, b) => {
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    },
  },
];

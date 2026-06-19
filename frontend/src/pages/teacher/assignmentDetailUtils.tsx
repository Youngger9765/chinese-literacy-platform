/* eslint-disable no-use-before-define -- pre-existing pattern, not TDZ risk (#2289) */
/**
 * UI utility helpers for AssignmentDetailPanel and sub-components (Issue #1936).
 * Extracted from AssignmentDetailPanel.tsx to be shared across the split pieces.
 */

/** Render a status badge element for a given submission status string. */
export function statusBadge(status: string): React.ReactElement {
  switch (status) {
    case 'in_progress':
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
          進行中
        </span>
      );
    case 'submitted':
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
          已提交
        </span>
      );
    case 'graded':
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
          已批改
        </span>
      );
    default:
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
          待完成
        </span>
      );
  }
}

/** Format an ISO date string to zh-TW locale short date, or '-' for null. */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// React is used by statusBadge JSX — must be imported.
import React from 'react';

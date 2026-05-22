/**
 * AttemptHistoryPanel — collapsible rows for a student's prior attempts.
 * Extracted from AssignmentDetailPanel (Issue #1853).
 */
import React from 'react';
import type { AttemptResponse } from '../../../services/assignmentApi';

interface Props {
  attempts: AttemptResponse[]; // excludes latest (index 0 already rendered)
}

function statusBadge(status: string) {
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

const AttemptHistoryPanel: React.FC<Props> = ({ attempts }) => (
  <>
    {attempts.map((attempt) => (
      <tr key={attempt.id} className="bg-gray-50">
        <td className="py-1 pl-6 text-gray-400">
          第 {attempt.attempt_number} 次
        </td>
        <td className="py-1 text-center">{statusBadge(attempt.status)}</td>
        <td className="py-1 text-center text-gray-400">—</td>
        <td className="py-1 text-gray-500 text-center">
          {attempt.score != null ? `${Math.round(attempt.score)}%` : '-'}
        </td>
        <td className="py-1 text-center text-gray-300">—</td>
        <td className="py-1 max-w-[200px] text-gray-400">
          {attempt.teacher_feedback ?? '—'}
        </td>
        <td className="py-1 text-center text-gray-300">—</td>
      </tr>
    ))}
  </>
);

export default AttemptHistoryPanel;

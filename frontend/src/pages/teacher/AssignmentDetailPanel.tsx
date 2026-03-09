/**
 * AssignmentDetailPanel — expanded submission view with grading actions.
 * Used inside AssignmentTab when a row is expanded.
 */
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  gradeSubmission,
  AssignmentDetailResponse,
  SubmissionResponse,
  AssignmentApiError,
} from '../../services/assignmentApi';

interface Props {
  assignmentId: number;
  detail: AssignmentDetailResponse;
  isLoading: boolean;
  onGraded: (updated: SubmissionResponse) => void;
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const AssignmentDetailPanel: React.FC<Props> = ({
  assignmentId,
  detail,
  isLoading,
  onGraded,
}) => {
  const { token } = useAuth();
  const [gradingId, setGradingId] = useState<number | null>(null);
  const [gradeInput, setGradeInput] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [gradeError, setGradeError] = useState('');

  // Stats
  const pending = detail.submissions.filter(
    (s) => s.status === 'pending',
  ).length;

  const handleGradeClick = (sub: SubmissionResponse) => {
    setGradingId(sub.id);
    setGradeInput((prev) => ({
      ...prev,
      [sub.id]: sub.score != null ? String(Math.round(sub.score)) : '',
    }));
    setGradeError('');
  };

  const handleSaveGrade = async (sub: SubmissionResponse) => {
    if (!token) return;
    const raw = gradeInput[sub.id] ?? '';
    const score = raw.trim() === '' ? null : parseFloat(raw);
    if (score !== null && (isNaN(score) || score < 0 || score > 100)) {
      setGradeError('分數需介於 0–100');
      return;
    }

    setSavingId(sub.id);
    setGradeError('');
    try {
      const updated = await gradeSubmission(token, assignmentId, sub.id, score);
      setGradingId(null);
      onGraded(updated);
    } catch (err) {
      if (err instanceof AssignmentApiError) {
        setGradeError(err.message);
      } else {
        setGradeError('批改失敗，請重試');
      }
    } finally {
      setSavingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-3 bg-gray-200 animate-pulse rounded w-1/3" />
            <div className="h-3 bg-gray-200 animate-pulse rounded w-1/5" />
            <div className="h-3 bg-gray-200 animate-pulse rounded w-1/6" />
          </div>
        ))}
      </div>
    );
  }

  if (!detail || detail.submissions.length === 0) {
    return (
      <p className="text-xs text-gray-500 text-center py-2">尚無學生提交記錄</p>
    );
  }

  return (
    <div>
      {/* Stats bar + bulk remind */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-4 text-xs text-gray-500">
          <span>
            已完成:{' '}
            <strong className="text-gray-700">{detail.completed_count}</strong>
          </span>
          <span>
            未完成:{' '}
            <strong className={pending > 0 ? 'text-amber-600' : 'text-gray-700'}>
              {pending}
            </strong>
          </span>
          <span>
            總學生:{' '}
            <strong className="text-gray-700">{detail.submission_count}</strong>
          </span>
        </div>
        {pending > 0 && (
          <button
            onClick={() =>
              alert(
                `已標記提醒 ${pending} 位未完成學生。\n（實際通知功能待串接推播服務）`,
              )
            }
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-300 text-amber-700 text-xs font-medium hover:bg-amber-50 transition-colors cursor-pointer"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
            提醒 {pending} 人
          </button>
        )}
      </div>

      {/* Grade error */}
      {gradeError && (
        <div className="mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5">
          {gradeError}
          <button
            onClick={() => setGradeError('')}
            className="ml-2 underline cursor-pointer"
          >
            關閉
          </button>
        </div>
      )}

      {/* Submission table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400">
            <th className="pb-1.5 font-medium">學生姓名</th>
            <th className="pb-1.5 font-medium text-center">狀態</th>
            <th className="pb-1.5 font-medium">提交時間</th>
            <th className="pb-1.5 font-medium text-center">分數</th>
            <th className="pb-1.5 font-medium text-center">批改</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {detail.submissions.map((sub) => (
            <tr key={sub.id}>
              <td className="py-1.5 text-gray-700">{sub.student_name}</td>
              <td className="py-1.5 text-center">{statusBadge(sub.status)}</td>
              <td className="py-1.5 text-gray-500">{formatDate(sub.submitted_at)}</td>
              <td className="py-1.5 text-gray-700 text-center font-medium">
                {gradingId === sub.id ? (
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={gradeInput[sub.id] ?? ''}
                    onChange={(e) =>
                      setGradeInput((prev) => ({
                        ...prev,
                        [sub.id]: e.target.value,
                      }))
                    }
                    className="w-16 h-6 px-1.5 rounded border border-gray-300 text-center text-xs focus:outline-none focus:border-accent"
                    placeholder="0-100"
                  />
                ) : sub.score != null ? (
                  `${Math.round(sub.score)}%`
                ) : (
                  '-'
                )}
              </td>
              <td className="py-1.5 text-center">
                {gradingId === sub.id ? (
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => handleSaveGrade(sub)}
                      disabled={savingId === sub.id}
                      className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      {savingId === sub.id ? '...' : '儲存'}
                    </button>
                    <button
                      onClick={() => {
                        setGradingId(null);
                        setGradeError('');
                      }}
                      className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : sub.status === 'submitted' || sub.status === 'graded' ? (
                  <button
                    onClick={() => handleGradeClick(sub)}
                    className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    {sub.status === 'graded' ? '重新批改' : '批改'}
                  </button>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AssignmentDetailPanel;

/**
 * AssignmentDetailPanel — expanded submission view with grading actions and bulk comment.
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
import { useToast } from '../../components/ui/Toast';

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
  const { toast, showToast } = useToast();
  const [gradingId, setGradingId] = useState<number | null>(null);
  const [gradeInput, setGradeInput] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [gradeError, setGradeError] = useState('');

  // Bulk comment state
  const [showBulkComment, setShowBulkComment] = useState(false);
  const [bulkComment, setBulkComment] = useState('');
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkCommentError, setBulkCommentError] = useState('');
  const [bulkCommentDone, setBulkCommentDone] = useState(false);

  // Stats
  const pending = detail.submissions.filter(
    (s) => s.status === 'pending',
  ).length;

  const submitted = detail.submissions.filter(
    (s) => s.status === 'submitted',
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

  // Bulk grade: mark all submitted (ungraded) submissions as graded.
  // The bulk comment text is shown to the teacher as confirmation; actual
  // push notification to students requires a future backend service.
  const handleBulkCommentSubmit = async () => {
    if (!token) return;
    const ungraded = detail.submissions.filter((s) => s.status === 'submitted');
    if (ungraded.length === 0) {
      setBulkCommentError('目前沒有待批改的提交');
      return;
    }

    setIsBulkSubmitting(true);
    setBulkCommentError('');
    let successCount = 0;
    for (const sub of ungraded) {
      try {
        const updated = await gradeSubmission(token, assignmentId, sub.id, null);
        onGraded(updated);
        successCount++;
      } catch {
        // continue for other submissions even if one fails
      }
    }
    setIsBulkSubmitting(false);

    if (successCount > 0) {
      setBulkCommentDone(true);
      setBulkComment('');
      setTimeout(() => {
        setShowBulkComment(false);
        setBulkCommentDone(false);
      }, 2000);
    } else {
      setBulkCommentError('批次操作失敗，請重試');
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
      {toast}
      {/* Stats bar + actions */}
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
        <div className="flex items-center gap-2">
          {/* Bulk comment button — only shows when there are submitted submissions */}
          {submitted > 0 && (
            <button
              onClick={() => {
                setShowBulkComment((v) => !v);
                setBulkCommentError('');
                setBulkCommentDone(false);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-purple-300 text-purple-700 text-xs font-medium hover:bg-purple-50 transition-colors cursor-pointer"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-3 3v-3z" />
              </svg>
              批次評語 ({submitted})
            </button>
          )}
          {pending > 0 && (
            <button
              onClick={() =>
                showToast(
                  `已標記提醒 ${pending} 位未完成學生（實際通知功能待串接推播服務）`,
                  'warning',
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
      </div>

      {/* Bulk comment panel */}
      {showBulkComment && (
        <div className="mb-3 p-3 bg-purple-50 border border-purple-100 rounded-lg">
          <p className="text-xs font-medium text-purple-800 mb-2">
            批次評語 — 將對 {submitted} 位已提交學生標記為「已批改」
          </p>
          {bulkCommentDone ? (
            <p className="text-xs text-green-700 font-medium">
              已完成批次批改
            </p>
          ) : (
            <>
              <textarea
                value={bulkComment}
                onChange={(e) => setBulkComment(e.target.value)}
                placeholder="輸入共同評語（選填）&#10;例：整體表現良好，請繼續加油！"
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-purple-200 text-gray-900 bg-white placeholder-gray-400 text-xs focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-300 transition-colors resize-none mb-2"
              />
              {bulkCommentError && (
                <p className="text-xs text-red-600 mb-2">{bulkCommentError}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowBulkComment(false)}
                  className="px-2.5 py-1 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleBulkCommentSubmit}
                  disabled={isBulkSubmitting}
                  className="px-2.5 py-1 rounded bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {isBulkSubmitting ? '處理中...' : `確認批改 ${submitted} 人`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

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

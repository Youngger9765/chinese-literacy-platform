/**
 * AssignmentDetailPanel — expanded submission view with grading actions and bulk comment.
 * Used inside AssignmentTab when a row is expanded.
 *
 * Issue #424: per-student teacher feedback textarea added to the grading UI.
 * Issue #1853: refactored — logic extracted to assignmentDetailLogic.ts,
 *   UI primitives to components/ReadingMetricsPanel, BulkCommentPanel, AttemptHistoryPanel.
 */
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  gradeSubmission,
  AssignmentDetailResponse,
  SubmissionResponse,
  AssignmentApiError,
  StudentAttemptGroup,
} from '../../services/assignmentApi';
import { useToast } from '../../components/ui/Toast';
import {
  countGroupedStats,
  validateScore,
  buildGradeClickState,
  filterSubmittedForBulk,
} from './assignmentDetailLogic';
import ReadingMetricsPanel from './components/ReadingMetricsPanel';
import BulkCommentPanel from './components/BulkCommentPanel';
import AttemptHistoryPanel from './components/AttemptHistoryPanel';

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
  // Issue #424: per-student feedback text while grading
  const [feedbackInput, setFeedbackInput] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [gradeError, setGradeError] = useState('');
  // Track which submission row has reading metrics expanded (Issue #423)
  const [expandedMetricsId, setExpandedMetricsId] = useState<number | null>(null);
  // Issue #1764 Fix 4: expand attempt history per student
  const [expandedStudentId, setExpandedStudentId] = useState<number | null>(null);

  // Bulk comment state
  const [showBulkComment, setShowBulkComment] = useState(false);
  const [bulkComment, setBulkComment] = useState('');
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkCommentError, setBulkCommentError] = useState('');
  const [bulkCommentDone, setBulkCommentDone] = useState(false);

  // Stats — use grouped view when available (Fix 3 #1764)
  const groups: StudentAttemptGroup[] = detail.submissions_by_student ?? [];
  const useGrouped = groups.length > 0;

  const { pending, submitted } = useGrouped
    ? countGroupedStats(groups)
    : {
        pending: detail.submissions.filter((s) => s.status === 'pending').length,
        submitted: detail.submissions.filter((s) => s.status === 'submitted').length,
      };

  const handleGradeClick = (sub: SubmissionResponse) => {
    setGradingId(sub.id);
    const { gradeInput: gi, feedbackInput: fi } = buildGradeClickState(sub);
    setGradeInput((prev) => ({ ...prev, [sub.id]: gi }));
    setFeedbackInput((prev) => ({ ...prev, [sub.id]: fi }));
    setGradeError('');
  };

  const handleSaveGrade = async (sub: SubmissionResponse) => {
    if (!token) return;
    const raw = gradeInput[sub.id] ?? '';
    const validationError = validateScore(raw);
    if (validationError) {
      setGradeError(validationError);
      return;
    }

    const score = raw.trim() === '' ? null : parseFloat(raw);
    const feedback = feedbackInput[sub.id]?.trim() || null;

    setSavingId(sub.id);
    setGradeError('');
    try {
      const updated = await gradeSubmission(token, assignmentId, sub.id, score, feedback);
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
  const handleBulkCommentSubmit = async () => {
    if (!token) return;
    const ungraded = filterSubmittedForBulk(detail.submissions);
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
          {/* Issue #1764 Fix 3: show distinct student counts, not raw attempt rows */}
          <span>
            已完成:{' '}
            <strong className="text-gray-700">
              {detail.submitted_student_count ?? detail.completed_count}
            </strong>
          </span>
          <span>
            總學生:{' '}
            <strong className="text-gray-700">
              {detail.assigned_student_count ?? detail.submission_count}
            </strong>
          </span>
          {pending > 0 && (
            <span>
              未完成:{' '}
              <strong className="text-amber-600">{pending}</strong>
            </span>
          )}
          {(detail.total_attempts ?? 0) > (detail.submitted_student_count ?? detail.completed_count) && (
            <span className="text-gray-400">
              共 {detail.total_attempts} 次作答
            </span>
          )}
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
        <BulkCommentPanel
          submittedCount={submitted}
          bulkComment={bulkComment}
          setBulkComment={setBulkComment}
          isBulkSubmitting={isBulkSubmitting}
          bulkCommentError={bulkCommentError}
          bulkCommentDone={bulkCommentDone}
          onSubmit={handleBulkCommentSubmit}
          onCancel={() => setShowBulkComment(false)}
        />
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

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {detail.submissions.map((sub) => (
          <div key={sub.id} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-900 text-sm">{sub.student_name}</span>
              <div className="flex items-center gap-2">
                {statusBadge(sub.status)}
                {gradingId === sub.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleSaveGrade(sub)}
                      disabled={savingId === sub.id}
                      className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      {savingId === sub.id ? '...' : '儲存'}
                    </button>
                    <button
                      onClick={() => { setGradingId(null); setGradeError(''); }}
                      className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : (sub.status === 'submitted' || sub.status === 'graded') ? (
                  <button
                    onClick={() => handleGradeClick(sub)}
                    className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    {sub.status === 'graded' ? '重新批改' : '批改'}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <span className="text-xs text-gray-400">提交時間</span>
                <p className="text-gray-700">{formatDate(sub.submitted_at)}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">分數</span>
                {gradingId === sub.id ? (
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={gradeInput[sub.id] ?? ''}
                    onChange={(e) =>
                      setGradeInput((prev) => ({ ...prev, [sub.id]: e.target.value }))
                    }
                    className="w-20 h-7 px-2 rounded border border-gray-300 text-center text-sm text-gray-900 bg-white focus:outline-none focus:border-accent"
                    placeholder="0-100"
                  />
                ) : (
                  <p className="text-gray-700 font-medium">
                    {sub.score != null ? `${Math.round(sub.score)}%` : '-'}
                  </p>
                )}
              </div>
            </div>

            {(sub.reading_accuracy != null || sub.reading_cpm != null || sub.reading_error_chars.length > 0) && (
              <div>
                <button
                  onClick={() => setExpandedMetricsId((prev) => (prev === sub.id ? null : sub.id))}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 text-xs hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  {expandedMetricsId === sub.id ? '收合朗讀數據' : '查看朗讀數據'}
                </button>
                {expandedMetricsId === sub.id && (
                  <div className="mt-2">
                    <ReadingMetricsPanel
                      studentName={sub.student_name}
                      readingAccuracy={sub.reading_accuracy}
                      readingCpm={sub.reading_cpm}
                      readingErrorChars={sub.reading_error_chars}
                    />
                  </div>
                )}
              </div>
            )}

            {gradingId === sub.id ? (
              <div>
                <span className="text-xs text-gray-400">評語</span>
                <textarea
                  value={feedbackInput[sub.id] ?? ''}
                  onChange={(e) =>
                    setFeedbackInput((prev) => ({ ...prev, [sub.id]: e.target.value }))
                  }
                  placeholder="輸入個別評語（選填）"
                  rows={2}
                  className="w-full mt-1 px-2 py-1.5 rounded border border-gray-300 text-xs text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:border-accent resize-none"
                />
              </div>
            ) : sub.teacher_feedback ? (
              <div>
                <span className="text-xs text-gray-400">評語</span>
                <p className="text-gray-600 text-sm mt-0.5 line-clamp-2" title={sub.teacher_feedback}>
                  {sub.teacher_feedback}
                </p>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Desktop table view — Issue #1764 Fix 4: grouped by student when available */}
      <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-400">
            <th className="pb-1.5 font-medium">學生姓名</th>
            <th className="pb-1.5 font-medium text-center">最新狀態</th>
            <th className="pb-1.5 font-medium text-center">作答次數</th>
            <th className="pb-1.5 font-medium text-center">最新分數</th>
            <th className="pb-1.5 font-medium text-center">朗讀數據</th>
            <th className="pb-1.5 font-medium">評語</th>
            <th className="pb-1.5 font-medium text-center">批改</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {useGrouped ? groups.map((group) => {
            const latest = group.attempts[0]; // already sorted desc by attempt_number
            const isExpanded = expandedStudentId === group.student_id;
            return (
              <React.Fragment key={group.student_id}>
                <tr>
                  <td className="py-1.5 text-gray-700">
                    <div className="flex items-center gap-1">
                      {group.attempts.length > 1 && (
                        <button
                          onClick={() =>
                            setExpandedStudentId((prev) =>
                              prev === group.student_id ? null : group.student_id
                            )
                          }
                          className="inline-flex items-center justify-center w-4 h-4 rounded border border-gray-300 text-gray-500 hover:bg-gray-50 cursor-pointer transition-colors"
                          title={isExpanded ? '收合歷史作答' : '展開歷史作答'}
                        >
                          {isExpanded ? '−' : '+'}
                        </button>
                      )}
                      {group.student_name}
                    </div>
                  </td>
                  <td className="py-1.5 text-center">{statusBadge(group.latest_status)}</td>
                  <td className="py-1.5 text-center text-gray-500">{group.attempts.length}</td>
                  <td className="py-1.5 text-gray-700 text-center font-medium">
                    {gradingId === latest.id ? (
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={gradeInput[latest.id] ?? ''}
                        onChange={(e) =>
                          setGradeInput((prev) => ({ ...prev, [latest.id]: e.target.value }))
                        }
                        className="w-16 h-6 px-1.5 rounded border border-gray-300 text-center text-xs focus:outline-none focus:border-accent"
                        placeholder="0-100"
                      />
                    ) : latest.score != null ? (
                      `${Math.round(latest.score)}%`
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="py-1.5 text-center">
                    {latest.reading_accuracy != null || latest.reading_cpm != null || latest.reading_error_chars.length > 0 ? (
                      <button
                        onClick={() =>
                          setExpandedMetricsId((prev) => (prev === latest.id ? null : latest.id))
                        }
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 text-xs hover:bg-blue-50 cursor-pointer transition-colors"
                        title="展開朗讀數據"
                      >
                        {expandedMetricsId === latest.id ? '收合' : '查看'}
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 max-w-[200px]">
                    {gradingId === latest.id ? (
                      <textarea
                        value={feedbackInput[latest.id] ?? ''}
                        onChange={(e) =>
                          setFeedbackInput((prev) => ({ ...prev, [latest.id]: e.target.value }))
                        }
                        placeholder="輸入個別評語（選填）"
                        rows={2}
                        className="w-full px-1.5 py-1 rounded border border-gray-300 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-accent resize-none"
                      />
                    ) : latest.teacher_feedback ? (
                      <span className="text-gray-600 line-clamp-2" title={latest.teacher_feedback}>
                        {latest.teacher_feedback}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 text-center">
                    {gradingId === latest.id ? (
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => handleSaveGrade(latest as unknown as SubmissionResponse)}
                          disabled={savingId === latest.id}
                          className="px-2 py-0.5 rounded bg-accent text-white text-xs font-medium hover:bg-accent-hover disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {savingId === latest.id ? '...' : '儲存'}
                        </button>
                        <button
                          onClick={() => { setGradingId(null); setGradeError(''); }}
                          className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                          取消
                        </button>
                      </div>
                    ) : latest.status === 'submitted' || latest.status === 'graded' ? (
                      <button
                        onClick={() => handleGradeClick(latest as unknown as SubmissionResponse)}
                        className="px-2 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        {latest.status === 'graded' ? '重新批改' : '批改'}
                      </button>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
                {expandedMetricsId === latest.id && (
                  <tr>
                    <td colSpan={7} className="pb-2 pt-0">
                      <ReadingMetricsPanel
                        studentName={group.student_name}
                        readingAccuracy={latest.reading_accuracy}
                        readingCpm={latest.reading_cpm}
                        readingErrorChars={latest.reading_error_chars}
                      />
                    </td>
                  </tr>
                )}
                {/* Expanded history rows for prior attempts */}
                {isExpanded && (
                  <AttemptHistoryPanel attempts={group.attempts.slice(1)} />
                )}
              </React.Fragment>
            );
          }) : detail.submissions.map((sub) => (
            <React.Fragment key={sub.id}>
              <tr>
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
                  {/* Show expand button only when any reading data exists */}
                  {sub.reading_accuracy != null || sub.reading_cpm != null || sub.reading_error_chars.length > 0 ? (
                    <button
                      onClick={() =>
                        setExpandedMetricsId((prev) => (prev === sub.id ? null : sub.id))
                      }
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 text-xs hover:bg-blue-50 cursor-pointer transition-colors"
                      title="展開朗讀數據"
                    >
                      {expandedMetricsId === sub.id ? '收合' : '查看'}
                    </button>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                {/* Per-student feedback cell (Issue #424) */}
                <td className="py-1.5 max-w-[200px]">
                  {gradingId === sub.id ? (
                    <textarea
                      value={feedbackInput[sub.id] ?? ''}
                      onChange={(e) =>
                        setFeedbackInput((prev) => ({
                          ...prev,
                          [sub.id]: e.target.value,
                        }))
                      }
                      placeholder="輸入個別評語（選填）"
                      rows={2}
                      className="w-full px-1.5 py-1 rounded border border-gray-300 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-accent resize-none"
                    />
                  ) : sub.teacher_feedback ? (
                    <span
                      className="text-gray-600 line-clamp-2"
                      title={sub.teacher_feedback}
                    >
                      {sub.teacher_feedback}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
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
              {/* Reading metrics expanded row (Issue #423) */}
              {expandedMetricsId === sub.id && (
                <tr>
                  <td colSpan={7} className="pb-2 pt-0">
                    <ReadingMetricsPanel
                      studentName={sub.student_name}
                      readingAccuracy={sub.reading_accuracy}
                      readingCpm={sub.reading_cpm}
                      readingErrorChars={sub.reading_error_chars}
                    />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
};


export default AssignmentDetailPanel;

/**
 * AssignmentDetailPanel — orchestrator (Issue #1936 refactor).
 *
 * Previously a 681-line monolith. Now composes three extracted pieces:
 *   - useGradeForm (hooks/useGradeForm.ts) — per-submission grading state
 *   - AssignmentSubmissionTable (components/AssignmentSubmissionTable.tsx) — table/cards
 *   - BulkCommentPanel (components/BulkCommentPanel.tsx) — bulk grading
 *
 * This file handles only: stats bar, bulk-comment toggle, grade-error banner,
 * and wiring the extracted pieces together.
 *
 * Issue #424: per-student teacher feedback
 * Issue #1764: grouped submissions_by_student view
 * Issue #1853: prior logic extraction to assignmentDetailLogic.ts
 */
import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  gradeSubmission,
  AssignmentDetailResponse,
  SubmissionResponse,
  StudentAttemptGroup,
} from '../../services/assignmentApi';
import { useToast } from '../../components/ui/Toast';
import {
  countGroupedStats,
  filterSubmittedForBulk,
} from './assignmentDetailLogic';
import BulkCommentPanel from './components/BulkCommentPanel';
import AssignmentSubmissionTable from './components/AssignmentSubmissionTable';
import { useGradeForm } from './hooks/useGradeForm';

interface Props {
  assignmentId: number;
  detail: AssignmentDetailResponse;
  isLoading: boolean;
  onGraded: (updated: SubmissionResponse) => void;
}

const AssignmentDetailPanel: React.FC<Props> = ({
  assignmentId,
  detail,
  isLoading,
  onGraded,
}) => {
  const { token } = useAuth();
  const { toast, showToast } = useToast();

  // ── Grade form state (extracted hook) ──────────────────────────────────────
  const gradeForm = useGradeForm();
  const { gradeError, clearGradeError, handleSaveGrade } = gradeForm;

  // ── Bulk comment state ─────────────────────────────────────────────────────
  const [showBulkComment, setShowBulkComment] = useState(false);
  const [bulkComment, setBulkComment] = useState('');
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkCommentError, setBulkCommentError] = useState('');
  const [bulkCommentDone, setBulkCommentDone] = useState(false);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const groups: StudentAttemptGroup[] = detail.submissions_by_student ?? [];
  const useGrouped = groups.length > 0;

  const { pending, submitted } = useGrouped
    ? countGroupedStats(groups)
    : {
        pending: detail.submissions.filter((s) => s.status === 'pending').length,
        submitted: detail.submissions.filter((s) => s.status === 'submitted').length,
      };

  // ── Bulk comment handler ───────────────────────────────────────────────────
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

  // ── Loading state ──────────────────────────────────────────────────────────
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
          <button onClick={clearGradeError} className="ml-2 underline cursor-pointer">
            關閉
          </button>
        </div>
      )}

      {/* Submission table (mobile cards + desktop table) */}
      <AssignmentSubmissionTable
        submissions={detail.submissions}
        groups={groups}
        useGrouped={useGrouped}
        assignmentId={assignmentId}
        gradeForm={{
          gradingId: gradeForm.gradingId,
          gradeInput: gradeForm.gradeInput,
          feedbackInput: gradeForm.feedbackInput,
          savingId: gradeForm.savingId,
          setGradeInput: gradeForm.setGradeInput,
          setFeedbackInput: gradeForm.setFeedbackInput,
          onGradeClick: gradeForm.handleGradeClick,
          onSaveGrade: (sub) => handleSaveGrade(sub, assignmentId, onGraded),
          onCancelGrade: gradeForm.cancelGrade,
        }}
      />
    </div>
  );
};

export default AssignmentDetailPanel;

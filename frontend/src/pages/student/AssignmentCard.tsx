/**
 * AssignmentCard.tsx — single assignment card with status badge, progress
 * strip, and action button.
 * Extracted from MyAssignments.tsx (Issue #1881).
 */

import React from 'react';
import type { StudentAssignmentResponse } from '../../services/assignmentApi';
import StepProgressStrip from '../../components/ui/StepProgressStrip';
import type { StepConfig } from '../../config/stepConfig';

// ---------------------------------------------------------------------------
// Helpers (previously inline in MyAssignments.tsx)
// ---------------------------------------------------------------------------

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function isOverdue(dueDateStr: string | null): boolean {
  if (!dueDateStr) return false;
  return new Date(dueDateStr) < new Date();
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'in_progress':
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-accent/10 text-accent">
          進行中
        </span>
      );
    case 'submitted':
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
          已完成
        </span>
      );
    case 'graded':
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-tertiary/10 text-tertiary">
          已批改
        </span>
      );
    default:
      return (
        <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-surface-container text-on-surface-variant">
          待完成
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AssignmentCardProps {
  assignment: StudentAssignmentResponse;
  steps: StepConfig[];
  completedSteps: Set<string>;
  currentStepPath: string | null;
  teacherName?: string;
  startingId: number | null;
  onStart: (assignmentId: number) => void;
  onResume: (assignment: StudentAssignmentResponse) => void;
  onViewReport: (assignment: StudentAssignmentResponse) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AssignmentCard: React.FC<AssignmentCardProps> = ({
  assignment: a,
  steps,
  completedSteps,
  currentStepPath,
  teacherName,
  startingId,
  onStart,
  onResume,
  onViewReport,
}) => {
  const ActionButton = () => {
    if (a.status === 'pending') {
      return (
        <button
          onClick={() => onStart(a.assignment_id)}
          disabled={startingId === a.assignment_id}
          className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {startingId === a.assignment_id ? '啟動中...' : '開始'}
        </button>
      );
    }
    if (a.status === 'in_progress') {
      return (
        <button
          onClick={() => onResume(a)}
          className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer shrink-0"
        >
          繼續
        </button>
      );
    }
    // submitted or graded
    return (
      <button
        onClick={() => onViewReport(a)}
        className="px-3 py-1.5 rounded-lg border border-[#E5E0D5] text-on-surface-variant text-xs font-medium hover:bg-surface-container-low transition-colors cursor-pointer shrink-0"
      >
        查看
      </button>
    );
  };

  return (
    <div className="bg-surface-container-lowest border border-[#E5E0D5] rounded-2xl shadow-editorial p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-on-surface truncate">
              {a.title || a.story_title}
            </h3>
            <StatusBadge status={a.status} />
          </div>

          {a.title && a.title !== a.story_title && (
            <p className="text-xs text-on-surface-variant mt-0.5">
              課文：{a.story_title}
            </p>
          )}

          {/* Classroom + teacher badge */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-xs text-accent font-medium">
              📍 {a.classroom_name}
              {teacherName && (
                <span className="text-accent/60 font-normal">｜{teacherName}指派</span>
              )}
            </span>
          </div>

          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {a.due_date && (
              <span
                className={`text-xs ${
                  isOverdue(a.due_date) ? 'text-error font-medium' : 'text-on-surface-variant'
                }`}
              >
                截止：{formatDate(a.due_date)}
                {isOverdue(a.due_date) && (
                  <span className="ml-1 inline-block px-1 py-0.5 rounded text-xs font-medium bg-error/10 text-error">
                    已逾期
                  </span>
                )}
              </span>
            )}

            {a.score != null && (
              <span className="text-xs text-on-surface font-medium">
                分數：{Math.round(a.score)}%
              </span>
            )}

            {a.submitted_at && (
              <span className="text-xs text-on-surface-variant">
                提交於 {formatDate(a.submitted_at)}
              </span>
            )}
          </div>

          {/* Issue #424: per-student teacher feedback */}
          {a.teacher_feedback && (
            <div className="mt-2 px-2.5 py-2 bg-tertiary/5 border border-tertiary/20 rounded-lg">
              <p className="text-xs font-medium text-tertiary mb-0.5">老師評語</p>
              <p className="text-xs text-on-surface-variant">{a.teacher_feedback}</p>
            </div>
          )}

          {steps.length > 0 && (
            <div className="mt-2.5">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] text-on-surface-variant">學習關卡進度</p>
                <p className="text-[11px] text-on-surface-variant/60">
                  {completedSteps.size}/{steps.length}
                </p>
              </div>
              <StepProgressStrip
                steps={steps}
                completedSteps={completedSteps}
                currentStepPath={currentStepPath}
              />
            </div>
          )}

          {a.description && (
            <p className="text-xs text-on-surface-variant mt-1.5 line-clamp-2">
              {a.description}
            </p>
          )}
        </div>

        <div className="shrink-0">
          <ActionButton />
        </div>
      </div>
    </div>
  );
};

export default AssignmentCard;

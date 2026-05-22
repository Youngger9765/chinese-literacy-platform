import React from 'react';
import {
  AssignmentDetailResponse,
  AssignmentResponse,
  SubmissionResponse,
} from '../../../services/assignmentApi';
import { completionPercentage, formatDate, isOverdue } from './assignmentUtils';
import AssignmentExpandedPanel from './AssignmentExpandedPanel';
import AssignmentInlineEdit from './AssignmentInlineEdit';

export interface AssignmentCardProps {
  assignment: AssignmentResponse;
  isExpanded: boolean;
  isConfirmingDelete: boolean;
  isDeleting: boolean;
  isEditing: boolean;
  editTitle: string;
  setEditTitle: (value: string) => void;
  editDescription: string;
  setEditDescription: (value: string) => void;
  editDueDate: string;
  setEditDueDate: (value: string) => void;
  editError: string;
  isSavingEdit: boolean;
  expandedDetail: AssignmentDetailResponse | null;
  isLoadingDetail: boolean;
  onExpand: (assignmentId: number) => void;
  onToggleActive: (assignment: AssignmentResponse) => void;
  onEdit: (assignment: AssignmentResponse) => void;
  onCancelEdit: () => void;
  onSaveEdit: (assignmentId: number) => void;
  onDelete: (assignment: AssignmentResponse) => void;
  onConfirmDelete: (assignmentId: number | null) => void;
  onGraded: (updated: SubmissionResponse) => void;
}

export const AssignmentCard: React.FC<AssignmentCardProps> = ({
  assignment,
  isExpanded,
  isConfirmingDelete,
  isDeleting,
  isEditing,
  editTitle,
  setEditTitle,
  editDescription,
  setEditDescription,
  editDueDate,
  setEditDueDate,
  editError,
  isSavingEdit,
  expandedDetail,
  isLoadingDetail,
  onExpand,
  onToggleActive,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onConfirmDelete,
  onGraded,
}) => {
  const displayTitle = assignment.title || assignment.story_title;
  const completionPct = completionPercentage(assignment.completed_count, assignment.submission_count);

  return (
    <div>
      <div
        className="bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:border-gray-300 transition-colors"
        onClick={() => {
          if (isConfirmingDelete || isEditing) return;
          onExpand(assignment.id);
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-medium text-gray-900 truncate">{displayTitle}</span>
          </div>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleActive(assignment);
            }}
            className={`shrink-0 inline-block px-1.5 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${
              assignment.is_active
                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {assignment.is_active ? '進行中' : '已停用'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-3">
          <div>
            <span className="text-xs text-gray-400">課文</span>
            <p className="text-gray-600 truncate">{assignment.story_title}</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">截止日期</span>
            <div>
              <span className={isOverdue(assignment.due_date) ? 'text-red-600' : 'text-gray-600'}>
                {formatDate(assignment.due_date)}
              </span>
              {isOverdue(assignment.due_date) && (
                <span className="ml-1 inline-block px-1 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                  已逾期
                </span>
              )}
            </div>
          </div>
          <div>
            <span className="text-xs text-gray-400">完成率</span>
            <p>
              <span
                className={`inline-block min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
                  completionPct === 100
                    ? 'bg-green-100 text-green-700'
                    : completionPct > 0
                      ? 'bg-accent-bg text-accent'
                      : 'bg-gray-100 text-gray-500'
                }`}
              >
                {assignment.completed_count}/{assignment.submission_count}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-1 mt-3 pt-2 border-t border-gray-100" onClick={(event) => event.stopPropagation()}>
          {isConfirmingDelete ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDelete(assignment)}
                disabled={isDeleting}
                className="px-2 py-1 rounded bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {isDeleting ? '...' : '確認刪除'}
              </button>
              <button
                onClick={() => onConfirmDelete(null)}
                className="px-2 py-1 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
              >
                取消
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(assignment);
                }}
                className="p-1.5 rounded text-gray-400 hover:text-accent hover:bg-accent-bg transition-colors cursor-pointer"
                title="編輯作業"
                aria-label="編輯作業"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <button
                onClick={() => onConfirmDelete(assignment.id)}
                className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                title="刪除作業"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {isEditing && (
        <AssignmentInlineEdit
          editTitle={editTitle}
          setEditTitle={setEditTitle}
          editDescription={editDescription}
          setEditDescription={setEditDescription}
          editDueDate={editDueDate}
          setEditDueDate={setEditDueDate}
          editError={editError}
          isSavingEdit={isSavingEdit}
          onCancel={onCancelEdit}
          onSave={() => onSaveEdit(assignment.id)}
          variant="mobile"
        />
      )}

      {isExpanded && (
        <AssignmentExpandedPanel
          assignment={assignment}
          expandedDetail={expandedDetail}
          isLoadingDetail={isLoadingDetail}
          onGraded={onGraded}
          variant="mobile"
        />
      )}
    </div>
  );
};

export default AssignmentCard;

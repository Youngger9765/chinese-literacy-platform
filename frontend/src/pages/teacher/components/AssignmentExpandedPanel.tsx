import React from 'react';
import ReadingGoalsBadge from '../../../components/ui/ReadingGoalsBadge';
import {
  AssignmentDetailResponse,
  AssignmentResponse,
  SubmissionResponse,
} from '../../../services/assignmentApi';
import AssignmentDetailPanel from '../AssignmentDetailPanel';

export interface AssignmentExpandedPanelProps {
  assignment: AssignmentResponse;
  expandedDetail: AssignmentDetailResponse | null;
  isLoadingDetail: boolean;
  onGraded: (updated: SubmissionResponse) => void;
  variant?: 'mobile' | 'desktop';
}

export const AssignmentExpandedPanel: React.FC<AssignmentExpandedPanelProps> = ({
  assignment,
  expandedDetail,
  isLoadingDetail,
  onGraded,
  variant = 'desktop',
}) => (
  <div className={variant === 'mobile' ? 'mt-2 bg-gray-50 rounded-lg p-3' : ''}>
    <div className="mb-3">
      <ReadingGoalsBadge
        goals={{
          effectiveCpm: assignment.effective_cpm,
          effectiveAccuracy: assignment.effective_accuracy,
          difficultyLabel: assignment.difficulty_label,
          isCustom: assignment.target_cpm != null || assignment.target_accuracy != null,
        }}
        variant="compact"
      />
    </div>
    {expandedDetail ? (
      <AssignmentDetailPanel
        assignmentId={assignment.id}
        detail={expandedDetail}
        isLoading={isLoadingDetail}
        onGraded={onGraded}
      />
    ) : isLoadingDetail ? (
      <div className="flex items-center gap-2 py-4 justify-center">
        <div className="w-4 h-4 border-2 border-gray-300 border-t-accent rounded-full animate-spin" />
        <span className="text-xs text-gray-500">載入中...</span>
      </div>
    ) : (
      <p className="text-xs text-gray-500 py-4 text-center">無法載入作業詳情</p>
    )}
  </div>
);

export default AssignmentExpandedPanel;

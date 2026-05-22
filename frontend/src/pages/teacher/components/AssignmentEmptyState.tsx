import React from 'react';

export interface AssignmentEmptyStateProps {
  hasAssignments: boolean;
}

export const AssignmentEmptyState: React.FC<AssignmentEmptyStateProps> = ({ hasAssignments }) => (
  <div className="p-8 text-center">
    {!hasAssignments ? (
      <>
        <div className="inline-flex items-center justify-center w-12 h-12 bg-accent-bg rounded-xl mb-3">
          <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
            />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700 mb-1">尚未建立作業</p>
        <p className="text-xs text-gray-500">點選「建立作業」為班級指派學習任務</p>
      </>
    ) : (
      <p className="text-sm text-gray-500">此分類下沒有作業</p>
    )}
  </div>
);

export default AssignmentEmptyState;

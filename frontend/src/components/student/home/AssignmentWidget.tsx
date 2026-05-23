/**
 * AssignmentWidget — 班級作業 + 圖書館 2-column secondary tile grid.
 *
 * Extracted from StudentHome.tsx (Issue #1952)
 */

import React from 'react';

export interface AssignmentWidgetProps {
  pendingCount: number;
  onGoAssignments: () => void;
  onGoLibrary: () => void;
}

const AssignmentWidget: React.FC<AssignmentWidgetProps> = ({
  pendingCount,
  onGoAssignments,
  onGoLibrary,
}) => (
  <div className="grid grid-cols-2 gap-3">
    <button
      type="button"
      onClick={onGoAssignments}
      className="
        relative text-left
        bg-surface-container-lowest border border-[#E5E0D5] rounded-xl
        p-4 flex items-center gap-3
        transition-all duration-150
        hover:shadow-md hover:border-accent/40 active:scale-[0.99]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
      "
      aria-label="查看班級作業"
    >
      <span className="text-xl sm:text-2xl" aria-hidden="true">📋</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-on-surface leading-tight">班級作業</p>
        <p className="text-xs text-on-surface-variant mt-0.5">
          {pendingCount > 0 ? `${pendingCount} 個待完成` : '查看紀錄'}
        </p>
      </div>
      {pendingCount > 0 && (
        <span
          className="px-2 py-0.5 rounded-full bg-error/10 text-error text-[11px] font-bold tabular-nums"
          aria-hidden="true"
        >
          {pendingCount}
        </span>
      )}
    </button>

    <button
      type="button"
      onClick={onGoLibrary}
      className="
        text-left
        bg-surface-container-lowest border border-[#E5E0D5] rounded-xl
        p-4 flex items-center gap-3
        transition-all duration-150
        hover:shadow-md hover:border-accent/40 active:scale-[0.99]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1
      "
      aria-label="前往圖書館"
    >
      <span className="text-xl sm:text-2xl" aria-hidden="true">📚</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-on-surface leading-tight">圖書館</p>
        <p className="text-xs text-on-surface-variant mt-0.5">探索更多課文</p>
      </div>
    </button>
  </div>
);

export default AssignmentWidget;

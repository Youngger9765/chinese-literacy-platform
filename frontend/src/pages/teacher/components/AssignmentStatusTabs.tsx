import React from 'react';
import { StatusFilter } from '../hooks/useAssignments';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '進行中' },
  { key: 'overdue', label: '已逾期' },
  { key: 'inactive', label: '已停用' },
];

export interface AssignmentStatusTabsProps {
  statusFilter: StatusFilter;
  tabCounts: Record<StatusFilter, number>;
  onChange: (filter: StatusFilter) => void;
}

export const AssignmentStatusTabs: React.FC<AssignmentStatusTabsProps> = ({
  statusFilter,
  tabCounts,
  onChange,
}) => (
  <div className="px-5 pt-4 pb-0 flex gap-1 border-b border-gray-100">
    {STATUS_TABS.map((tab) => (
      <button
        key={tab.key}
        onClick={() => onChange(tab.key)}
        className={`px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
          statusFilter === tab.key
            ? 'border-accent text-accent bg-accent-bg'
            : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
        }`}
      >
        {tab.label}
        {tabCounts[tab.key] > 0 && (
          <span
            className={`ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-xs ${
              statusFilter === tab.key
                ? 'bg-accent text-white'
                : 'bg-gray-200 text-gray-600'
            }`}
          >
            {tabCounts[tab.key]}
          </span>
        )}
      </button>
    ))}
  </div>
);

export default AssignmentStatusTabs;

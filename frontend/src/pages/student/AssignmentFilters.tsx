/**
 * AssignmentFilters.tsx — filter tabs + sort dropdown + classroom pill filter.
 * Extracted from MyAssignments.tsx (Issue #1881).
 */

import React from 'react';
import { type SortKey, SORT_OPTIONS } from './assignmentSort';

export type FilterTab = 'pending' | 'completed' | 'graded';

export const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'pending', label: '待完成' },
  { key: 'completed', label: '已完成' },
  { key: 'graded', label: '已批改' },
];

interface Props {
  activeFilter: FilterTab;
  onFilterChange: (tab: FilterTab) => void;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  classroomNames: string[];
  classroomFilter: string;
  onClassroomFilterChange: (name: string) => void;
  showClassroomFilter: boolean;
}

const AssignmentFilters: React.FC<Props> = ({
  activeFilter,
  onFilterChange,
  sortKey,
  onSortChange,
  classroomNames,
  classroomFilter,
  onClassroomFilterChange,
  showClassroomFilter,
}) => {
  return (
    <>
      {/* Classroom pill filter — visible when student is in 2+ classrooms (#1158) */}
      {showClassroomFilter && (
        <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="依班級篩選">
          <button
            onClick={() => onClassroomFilterChange('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
              classroomFilter === 'all'
                ? 'bg-accent text-white'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            全部
          </button>
          {classroomNames.map((name) => (
            <button
              key={name}
              onClick={() => onClassroomFilterChange(name)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                classroomFilter === name
                  ? 'bg-accent text-white'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Filter tabs + sort */}
      <div className="flex items-center justify-between gap-2 border-b border-[#E5E0D5]">
        <nav className="flex -mb-px" aria-label="Filter tabs">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => onFilterChange(tab.key)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                activeFilter === tab.key
                  ? 'border-accent text-accent'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface hover:border-[#E5E0D5]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="mb-px text-xs text-on-surface-variant border border-[#E5E0D5] rounded-md px-2 py-1 bg-surface-container-lowest cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
          aria-label="排序方式"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
};

export default AssignmentFilters;

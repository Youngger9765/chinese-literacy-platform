/**
 * StoryListTable — Sortable, filterable table + filter bar for story listing.
 *
 * Extracted from StoryManagementPanel as part of refactor #1944.
 *
 * Responsibilities:
 * - Filter bar (search input + grade selector)
 * - Loading skeleton
 * - Error banner with retry
 * - Empty state
 * - AdminTable wrapper with story columns + edit/delete action buttons
 */

import React from 'react';
import AdminTable, { ColumnDef } from '../../components/admin/AdminTable';
import { StoryAdminListItem } from '../../services/adminStoryApi';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface StoryListTableProps {
  stories: StoryAdminListItem[];
  isLoading: boolean;
  loadError: string;
  searchQuery: string;
  gradeFilter: string;
  onSearchChange: (value: string) => void;
  onGradeChange: (value: string) => void;
  onRetry: () => void;
  onEdit: (story: StoryAdminListItem) => void;
  onDelete: (story: StoryAdminListItem) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

const StoryListTable: React.FC<StoryListTableProps> = ({
  stories,
  isLoading,
  loadError,
  searchQuery,
  gradeFilter,
  onSearchChange,
  onGradeChange,
  onRetry,
  onEdit,
  onDelete,
}) => {
  const storyColumns: ColumnDef<StoryAdminListItem>[] = [
    {
      key: 'lesson_number',
      header: '編號',
      render: (story) => (
        <span className="font-mono text-gray-500">{story.lesson_number}</span>
      ),
      className: 'w-16',
    },
    {
      key: 'title',
      header: '標題',
      render: (story) => (
        <span className="font-medium text-gray-900">{story.title}</span>
      ),
    },
    {
      key: 'grade_code',
      header: '年級',
      className: 'w-20',
    },
    {
      key: 'genre',
      header: '文體',
      className: 'w-24',
    },
    {
      key: 'paragraph_count',
      header: '段落數',
      className: 'w-20',
    },
    {
      key: 'char_count',
      header: '字數',
      className: 'w-20',
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-28 text-right',
      render: (story) => (
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => onEdit(story)}
            className="text-accent hover:underline text-xs font-medium cursor-pointer"
          >
            編輯
          </button>
          <button
            type="button"
            onClick={() => onDelete(story)}
            className="text-red-500 hover:underline text-xs font-medium cursor-pointer"
          >
            刪除
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="搜尋課文標題..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
        <select
          value={gradeFilter}
          onChange={(e) => onGradeChange(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 cursor-pointer"
        >
          <option value="">所有年級</option>
          {[4, 5, 6, 7, 8, 9].map((g) => (
            <option key={g} value={String(g)}>
              {g} 年級
            </option>
          ))}
        </select>
      </div>

      {/* Error banner */}
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {loadError}
          <button
            onClick={onRetry}
            className="ml-2 underline text-red-600 hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !loadError && stories.length === 0 && (
        <div className="rounded-2xl shadow-card px-4 py-12 text-center text-gray-400 text-sm bg-white">
          {searchQuery || gradeFilter ? '找不到符合條件的課文' : '尚無課文'}
        </div>
      )}

      {/* Table */}
      {!isLoading && !loadError && stories.length > 0 && (
        <AdminTable
          columns={storyColumns}
          rows={stories}
          rowKey={(story) => story.lesson_number}
          cardTitle={(story) => story.title}
        />
      )}
    </>
  );
};

export default StoryListTable;

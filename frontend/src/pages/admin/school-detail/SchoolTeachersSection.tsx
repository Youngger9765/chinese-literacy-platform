/**
 * SchoolTeachersSection — teacher list + search-and-assign panel.
 *
 * Extracted from SchoolDetailPanel (Issue #1849).
 * Uses AdminTable primitive + useDebouncedSearch hook.
 */
import React from 'react';
import { PlusIcon } from '../../../components/icons';
import AdminTable, { ColumnDef } from '../../../components/admin/AdminTable';
import { SchoolMemberResponse } from '../../../services/schoolApi';
import { UserListItem } from '../../../services/userApi';

export interface SchoolTeachersSectionProps {
  allTeacherMembers: SchoolMemberResponse[];
  isLoadingAllTeachers: boolean;

  showTeacherSearch: boolean;
  teacherSearchQuery: string;
  teacherSearchResults: UserListItem[];
  isSearchingTeachers: boolean;
  assigningUserId: number | null;

  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onSearchQueryChange: (v: string) => void;
  onAssignTeacher: (userId: number) => void;
}

const TEACHER_COLUMNS: ColumnDef<SchoolMemberResponse>[] = [
  { key: 'name', header: '姓名', render: (m) => <span className="font-medium text-gray-900">{m.name}</span> },
  { key: 'email', header: 'Email', render: (m) => m.email },
  {
    key: 'role_display_name',
    header: '角色',
    render: (m) => (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-accent-bg text-accent">
        {m.role_display_name}
      </span>
    ),
  },
];

const SchoolTeachersSection: React.FC<SchoolTeachersSectionProps> = ({
  allTeacherMembers,
  isLoadingAllTeachers,
  showTeacherSearch,
  teacherSearchQuery,
  teacherSearchResults,
  isSearchingTeachers,
  assigningUserId,
  onOpenSearch,
  onCloseSearch,
  onSearchQueryChange,
  onAssignTeacher,
}) => {
  return (
    <div className="bg-white rounded-2xl shadow-card">
      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-bold text-gray-900">教師</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{allTeacherMembers.length} 位</span>
          {!showTeacherSearch && (
            <button
              onClick={onOpenSearch}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
            >
              <PlusIcon className="w-3.5 h-3.5" />
              指派教師
            </button>
          )}
        </div>
      </div>

      {/* Teacher search panel */}
      {showTeacherSearch && (
        <div className="p-5 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-gray-900">搜尋使用者並指派為教師</h4>
            <button
              onClick={onCloseSearch}
              className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              關閉
            </button>
          </div>
          <input
            type="text"
            value={teacherSearchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="輸入姓名或 email 搜尋..."
            autoFocus
            className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
          />
          {isSearchingTeachers && (
            <div className="flex items-center gap-2 mt-3">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-gray-400">搜尋中...</span>
            </div>
          )}
          {!isSearchingTeachers && teacherSearchResults.length > 0 && (
            <div className="mt-3 divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white overflow-hidden">
              {teacherSearchResults.map((user) => (
                <div key={user.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{user.name}</p>
                    <p className="text-xs text-gray-500">{user.email}</p>
                  </div>
                  <button
                    onClick={() => onAssignTeacher(user.id)}
                    disabled={assigningUserId === user.id}
                    className="px-3 py-1 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {assigningUserId === user.id ? '指派中...' : '指派'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {!isSearchingTeachers && teacherSearchQuery.trim().length >= 2 && teacherSearchResults.length === 0 && (
            <p className="mt-3 text-xs text-gray-400">找不到符合的使用者</p>
          )}
        </div>
      )}

      <div className="p-5">
        {isLoadingAllTeachers ? (
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-2/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
          </div>
        ) : allTeacherMembers.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-6">尚無教師</p>
        ) : (
          <AdminTable
            columns={TEACHER_COLUMNS}
            rows={allTeacherMembers}
            rowKey={(m) => m.user_id}
            cardTitle={(m) => m.name}
          />
        )}
      </div>
    </div>
  );
};

export default SchoolTeachersSection;

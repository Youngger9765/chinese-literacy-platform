/**
 * StudentSearchSection — search bar + results list for adding existing students.
 * Extracted from ClassroomDetailPanel (Issue #1850).
 */
import React from 'react';
import { StudentSearchResult } from '../../services/classroomApi';

interface StudentSearchSectionProps {
  searchQuery: string;
  searchResults: StudentSearchResult[];
  isSearching: boolean;
  addingStudentId: number | null;
  onSearchInputChange: (value: string) => void;
  onAddStudent: (studentId: number) => void;
  onClose: () => void;
}

const StudentSearchSection: React.FC<StudentSearchSectionProps> = ({
  searchQuery,
  searchResults,
  isSearching,
  addingStudentId,
  onSearchInputChange,
  onAddStudent,
  onClose,
}) => {
  return (
    <div className="p-5 border-b border-gray-100 bg-gray-50/50">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-gray-900">搜尋並新增學生</h4>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer">
          關閉
        </button>
      </div>
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchInputChange(e.target.value)}
        placeholder="輸入姓名或 email 搜尋..."
        autoFocus
        className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
      />
      {isSearching && (
        <div className="flex items-center gap-2 mt-3">
          <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-400">搜尋中...</span>
        </div>
      )}
      {!isSearching && searchResults.length > 0 && (
        <div className="mt-3 divide-y divide-gray-100 border border-gray-200 rounded-lg bg-white overflow-hidden">
          {searchResults.map((student) => (
            <div key={student.id} className="px-4 py-2.5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{student.name}</p>
                <p className="text-xs text-gray-500">{student.email}</p>
              </div>
              <button
                onClick={() => onAddStudent(student.id)}
                disabled={addingStudentId === student.id}
                className="px-3 py-1 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addingStudentId === student.id ? '加入中...' : '加入'}
              </button>
            </div>
          ))}
        </div>
      )}
      {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
        <p className="mt-3 text-xs text-gray-400">找不到符合的使用者</p>
      )}
    </div>
  );
};

export default StudentSearchSection;

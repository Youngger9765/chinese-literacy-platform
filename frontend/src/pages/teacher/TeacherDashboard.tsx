import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  listMyClassrooms,
  createClassroom,
  ClassroomResponse,
  ClassroomApiError,
} from '../../services/classroomApi';
import SchoolSwitcher from '../../components/teacher/SchoolSwitcher';

interface TeacherDashboardProps {
  onSelectClassroom: (classroomId: number) => void;
}

const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ onSelectClassroom }) => {
  const { token, user } = useAuth();
  const { activeSchoolId: teacherSchoolId, hasMultipleSchools } = useWorkspace();
  const [classrooms, setClassrooms] = useState<ClassroomResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Search & sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'grade' | 'students'>('name');

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newGrade, setNewGrade] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  /**
   * When the teacher is in multiple schools, filter classrooms to the
   * currently-selected school. Single-school teachers see all classrooms.
   */
  const visibleClassrooms = useMemo(() => {
    const base = hasMultipleSchools && teacherSchoolId != null
      ? classrooms.filter((cr) => cr.school_id === teacherSchoolId)
      : classrooms;
    return base
      .filter((cr) => !searchQuery || cr.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        if (sortBy === 'grade') return (a.grade ?? 99) - (b.grade ?? 99);
        if (sortBy === 'students') return b.student_count - a.student_count;
        return a.name.localeCompare(b.name, 'zh-TW');
      });
  }, [classrooms, searchQuery, sortBy, hasMultipleSchools, teacherSchoolId]);

  const loadClassrooms = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await listMyClassrooms(token);
      setClassrooms(data.items);
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setError(err.message);
      } else {
        setError('無法載入班級列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newName.trim()) return;

    setIsCreating(true);
    setCreateError('');
    try {
      if (!teacherSchoolId) {
        setCreateError('尚未指派學校，請聯繫管理員');
        setIsCreating(false);
        return;
      }
      const grade = newGrade ? parseInt(newGrade, 10) : undefined;
      await createClassroom(token, {
        name: newName.trim(),
        school_id: teacherSchoolId,
        grade,
      });
      setNewName('');
      setNewGrade('');
      setShowCreateForm(false);
      await loadClassrooms();
    } catch (err) {
      if (err instanceof ClassroomApiError) {
        setCreateError(err.message);
      } else {
        setCreateError('建立班級失敗');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  // Skeleton cards for loading state
  const SkeletonCard = () => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="h-5 bg-gray-200 animate-pulse rounded w-2/3 mb-3" />
      <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3 mb-2" />
      <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
    </div>
  );

  // Count used in the subtitle: visible after school filter, before text search
  const schoolFilteredCount = hasMultipleSchools && teacherSchoolId != null
    ? classrooms.filter((cr) => cr.school_id === teacherSchoolId).length
    : classrooms.length;

  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">班級管理</h1>
            <p className="text-sm text-gray-500 mt-1">
              {isLoading ? '載入中...' : `共 ${schoolFilteredCount} 個班級`}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* School switcher — only shown when teacher belongs to multiple schools */}
            <SchoolSwitcher />
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors whitespace-nowrap"
            >
              建立班級
            </button>
          </div>
        </div>

        {/* Search & sort */}
        {!isLoading && classrooms.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋班級名稱..."
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'grade' | 'students')}
              className="h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
            >
              <option value="name">依名稱排序</option>
              <option value="grade">依年級排序</option>
              <option value="students">依人數排序</option>
            </select>
          </div>
        )}

        {/* Create form */}
        {showCreateForm && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h2 className="text-base font-bold text-gray-900 mb-4">建立新班級</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              {createError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {createError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="classroom-name" className="block text-sm font-medium text-gray-700 mb-1">
                    班級名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="classroom-name"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="例：五年甲班"
                    required
                    autoFocus
                    className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="classroom-grade" className="block text-sm font-medium text-gray-700 mb-1">
                    年級
                  </label>
                  <select
                    id="classroom-grade"
                    value={newGrade}
                    onChange={(e) => setNewGrade(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                  >
                    <option value="">未指定</option>
                    <optgroup label="國小">
                      {[1, 2, 3, 4, 5, 6].map((g) => (
                        <option key={g} value={g}>{g} 年級</option>
                      ))}
                    </optgroup>
                    <optgroup label="國中">
                      {[7, 8, 9].map((g) => (
                        <option key={g} value={g}>{g} 年級</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false);
                    setCreateError('');
                    setNewName('');
                    setNewGrade('');
                  }}
                  className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !newName.trim()}
                  className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors"
                >
                  {isCreating ? '建立中...' : '建立'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="text-center py-6 bg-red-50 rounded-xl border border-red-200">
            <p className="text-red-700 text-sm">{error}</p>
            <button
              onClick={loadClassrooms}
              className="mt-2 text-sm text-red-600 underline hover:text-red-800"
            >
              重試
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* No search results */}
        {!isLoading && !error && visibleClassrooms.length === 0 && classrooms.length > 0 && searchQuery && (
          <div className="text-center py-8 text-sm text-gray-500">
            找不到符合「{searchQuery}」的班級
          </div>
        )}

        {/* No classrooms in selected school (multi-school, no text query) */}
        {!isLoading && !error && visibleClassrooms.length === 0 && classrooms.length > 0 && !searchQuery && hasMultipleSchools && (
          <div className="text-center py-8 text-sm text-gray-500">
            此學校目前沒有班級
          </div>
        )}

        {/* Classroom grid */}
        {!isLoading && !error && visibleClassrooms.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleClassrooms.map((cr) => {
              const isCoTeacher = user?.id != null && cr.teacher_id !== user.id;
              return (
                <button
                  key={cr.id}
                  onClick={() => onSelectClassroom(cr.id)}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 text-left hover:border-accent hover:shadow-md transition-all group cursor-pointer"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-bold text-gray-900 group-hover:text-accent transition-colors">
                      {cr.name}
                    </h3>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {isCoTeacher && (
                        <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded border border-green-200">
                          協同教師
                        </span>
                      )}
                      {!cr.is_active && (
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          已停用
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5 text-sm text-gray-500">
                    {cr.grade != null && (
                      <p>{cr.grade} 年級</p>
                    )}
                    <p>{cr.student_count} 位學生</p>
                    <p className="text-xs">{formatDate(cr.created_at)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Empty state — no classrooms at all */}
        {!isLoading && !error && classrooms.length === 0 && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-accent-bg rounded-2xl mb-4">
              <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">尚未建立班級</h3>
            <p className="text-sm text-gray-500 mb-4">建立你的第一個班級，開始管理學生</p>
            <button
              onClick={() => setShowCreateForm(true)}
              className="bg-accent hover:bg-accent-hover text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors"
            >
              建立班級
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherDashboard;

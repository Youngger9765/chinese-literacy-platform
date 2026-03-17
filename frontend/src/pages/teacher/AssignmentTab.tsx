import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getClassroomAssignments,
  getAssignmentDetail,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  AssignmentResponse,
  AssignmentDetailResponse,
  SubmissionResponse,
  AssignmentApiError,
} from '../../services/assignmentApi';
import { fetchStories } from '../../services/api';
import type { Story } from '../../types';
import AssignmentDetailPanel from './AssignmentDetailPanel';
import ReadingGoalsForm, { GoalsFormState } from '../../components/teacher/ReadingGoalsForm';
import ReadingGoalsBadge from '../../components/ui/ReadingGoalsBadge';

interface AssignmentTabProps {
  classroomId: number;
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'overdue';

const AssignmentTab: React.FC<AssignmentTabProps> = ({ classroomId }) => {
  const { token } = useAuth();

  // Assignment list
  const [assignments, setAssignments] = useState<AssignmentResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Status filter
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [selectedStoryId, setSelectedStoryId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formGoals, setFormGoals] = useState<GoalsFormState>({
    target_cpm: null,
    target_accuracy: null,
    difficulty_label: null,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Expand detail
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AssignmentDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const loadAssignments = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getClassroomAssignments(token, classroomId);
      setAssignments(data.items);
    } catch (err) {
      if (err instanceof AssignmentApiError) {
        setError(err.message);
      } else {
        setError('無法載入作業列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, classroomId]);

  const loadStories = useCallback(async () => {
    if (allStories.length > 0) return;
    setIsLoadingStories(true);
    try {
      const data = await fetchStories();
      setAllStories(data.stories);
    } catch {
      // silent
    } finally {
      setIsLoadingStories(false);
    }
  }, [allStories.length]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  // Story lookup map for display
  const storyMap = useMemo(() => {
    const map = new Map<string, Story>();
    allStories.forEach((s) => map.set(s.id, s));
    return map;
  }, [allStories]);

  // Suppress unused variable warning — storyMap used for future enhancements
  void storyMap;

  // Filtered assignments based on status tab
  const filteredAssignments = useMemo(() => {
    const now = new Date();
    return assignments.filter((a) => {
      switch (statusFilter) {
        case 'active':
          return a.is_active && (!a.due_date || new Date(a.due_date) >= now);
        case 'inactive':
          return !a.is_active;
        case 'overdue':
          return a.is_active && a.due_date != null && new Date(a.due_date) < now;
        default:
          return true;
      }
    });
  }, [assignments, statusFilter]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const now = new Date();
    return {
      all: assignments.length,
      active: assignments.filter(
        (a) => a.is_active && (!a.due_date || new Date(a.due_date) >= now),
      ).length,
      inactive: assignments.filter((a) => !a.is_active).length,
      overdue: assignments.filter(
        (a) => a.is_active && a.due_date != null && new Date(a.due_date) < now,
      ).length,
    };
  }, [assignments]);

  const handleOpenCreateForm = () => {
    setShowCreateForm(true);
    setCreateError('');
    setSelectedStoryId('');
    setFormTitle('');
    setFormDescription('');
    setFormDueDate('');
    setFormGoals({ target_cpm: null, target_accuracy: null, difficulty_label: null });
    loadStories();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedStoryId) return;

    setIsCreating(true);
    setCreateError('');
    try {
      await createAssignment(token, classroomId, {
        story_id: selectedStoryId,
        title: formTitle.trim() || undefined,
        description: formDescription.trim() || undefined,
        due_date: formDueDate || undefined,
        target_cpm: formGoals.target_cpm,
        target_accuracy: formGoals.target_accuracy,
        difficulty_label: formGoals.difficulty_label,
      });
      setShowCreateForm(false);
      await loadAssignments();
    } catch (err) {
      if (err instanceof AssignmentApiError) {
        setCreateError(err.message);
      } else {
        setCreateError('建立作業失敗');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggleActive = async (assignment: AssignmentResponse) => {
    if (!token) return;
    try {
      const updated = await updateAssignment(token, assignment.id, {
        is_active: !assignment.is_active,
      });
      setAssignments((prev) =>
        prev.map((a) => (a.id === updated.id ? updated : a)),
      );
    } catch (err) {
      if (err instanceof AssignmentApiError) {
        setError(err.message);
      } else {
        setError('更新狀態失敗');
      }
    }
  };

  const handleDelete = async (assignment: AssignmentResponse) => {
    if (!token) return;
    setDeletingId(assignment.id);
    setConfirmDeleteId(null);
    try {
      await deleteAssignment(token, assignment.id);
      setAssignments((prev) => prev.filter((a) => a.id !== assignment.id));
      // If the deleted assignment was expanded, collapse it
      if (expandedId === assignment.id) {
        setExpandedId(null);
        setExpandedDetail(null);
      }
    } catch (err) {
      if (err instanceof AssignmentApiError) {
        setError(err.message);
      } else {
        setError('刪除作業失敗');
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenEdit = (assignment: AssignmentResponse, e: React.MouseEvent) => {
    e.stopPropagation();
    const dueDateValue = assignment.due_date
      ? new Date(assignment.due_date).toISOString().slice(0, 10)
      : '';
    setEditingId(assignment.id);
    setEditTitle(assignment.title || '');
    setEditDescription(assignment.description || '');
    setEditDueDate(dueDateValue);
    setEditError('');
    setConfirmDeleteId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditError('');
  };

  const handleSaveEdit = async (assignmentId: number) => {
    if (!token) return;
    setIsSavingEdit(true);
    setEditError('');
    try {
      const updated = await updateAssignment(token, assignmentId, {
        title: editTitle.trim() || undefined,
        description: editDescription.trim() || undefined,
        due_date: editDueDate || null,
      });
      setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setEditingId(null);
    } catch (err) {
      if (err instanceof AssignmentApiError) {
        setEditError(err.message);
      } else {
        setEditError('儲存失敗，請再試一次');
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleRowClick = useCallback(
    async (assignmentId: number) => {
      if (expandedId === assignmentId) {
        setExpandedId(null);
        setExpandedDetail(null);
        return;
      }

      setExpandedId(assignmentId);
      if (!token) return;
      setIsLoadingDetail(true);
      setExpandedDetail(null);
      try {
        const detail = await getAssignmentDetail(token, assignmentId);
        setExpandedDetail(detail);
      } catch {
        setExpandedDetail(null);
      } finally {
        setIsLoadingDetail(false);
      }
    },
    [expandedId, token],
  );

  // Update a single submission in expandedDetail after grading
  const handleGraded = useCallback((updated: SubmissionResponse) => {
    setExpandedDetail((prev) => {
      if (!prev) return prev;
      const newSubs = prev.submissions.map((s) =>
        s.id === updated.id ? updated : s,
      );
      const completedCount = newSubs.filter((s) =>
        ['submitted', 'graded'].includes(s.status),
      ).length;
      return { ...prev, submissions: newSubs, completed_count: completedCount };
    });
    // Also update the summary row in assignments list
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.id !== expandedId) return a;
        const completedCount = a.completed_count;
        // If newly graded from submitted, count stays same (already counted)
        return { ...a, completed_count: completedCount };
      }),
    );
  }, [expandedId]);

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const isOverdue = (dueDateStr: string | null): boolean => {
    if (!dueDateStr) return false;
    return new Date(dueDateStr) < new Date();
  };

  if (isLoading) {
    return (
      <div className="p-5 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/3" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/4" />
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/6" />
          </div>
        ))}
      </div>
    );
  }

  if (error && assignments.length === 0) {
    return (
      <div className="p-5">
        <div className="text-center py-6 bg-red-50 rounded-lg border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button
            onClick={loadAssignments}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 cursor-pointer"
          >
            重試
          </button>
        </div>
      </div>
    );
  }

  const STATUS_TABS: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '進行中' },
    { key: 'overdue', label: '已逾期' },
    { key: 'inactive', label: '已停用' },
  ];

  return (
    <div>
      {/* Inline error */}
      {error && (
        <div className="mx-5 mt-5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline cursor-pointer">
            關閉
          </button>
        </div>
      )}

      {/* Header row */}
      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm text-gray-500">
          共 {assignments.length} 份作業
        </span>
        {!showCreateForm && (
          <button
            onClick={handleOpenCreateForm}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            建立作業
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="p-5 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-gray-900">建立新作業</h4>
            <button
              onClick={() => setShowCreateForm(false)}
              className="text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
            >
              關閉
            </button>
          </div>

          {createError && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-3">
              {createError}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label htmlFor="assign-story" className="block text-sm font-medium text-gray-700 mb-1">
                課文 <span className="text-red-500">*</span>
              </label>
              {isLoadingStories ? (
                <div className="flex items-center gap-2 py-2">
                  <div className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-gray-400">載入課文列表...</span>
                </div>
              ) : (
                <select
                  id="assign-story"
                  value={selectedStoryId}
                  onChange={(e) => setSelectedStoryId(e.target.value)}
                  required
                  className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                >
                  <option value="">選擇課文</option>
                  {allStories.map((story) => (
                    <option key={story.id} value={story.id}>
                      {story.title}
                      {story.grade ? ` (${story.grade}年級)` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label htmlFor="assign-title" className="block text-sm font-medium text-gray-700 mb-1">
                作業標題（選填）
              </label>
              <input
                id="assign-title"
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="留空則使用課文標題"
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>

            <div>
              <label htmlFor="assign-desc" className="block text-sm font-medium text-gray-700 mb-1">
                說明（選填）
              </label>
              <textarea
                id="assign-desc"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="作業說明或提示"
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors resize-none"
              />
            </div>

            <div>
              <label htmlFor="assign-due" className="block text-sm font-medium text-gray-700 mb-1">
                截止日期（選填）
              </label>
              <input
                id="assign-due"
                type="date"
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
              />
            </div>

            {/* Reading goals */}
            <div className="border-t border-gray-100 pt-3">
              <ReadingGoalsForm
                value={formGoals}
                onChange={setFormGoals}
                grade={
                  selectedStoryId
                    ? storyMap.get(selectedStoryId)?.grade ?? null
                    : null
                }
              />
            </div>

            {/* Buttons */}
            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isCreating || !selectedStoryId}
                className="bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg font-medium text-sm transition-colors cursor-pointer"
              >
                {isCreating ? '建立中...' : '確認建立'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Status filter tabs */}
      {assignments.length > 0 && (
        <div className="px-5 pt-4 pb-0 flex gap-1 border-b border-gray-100">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
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
      )}

      {/* Assignment list */}
      {filteredAssignments.length === 0 ? (
        <div className="p-8 text-center">
          {assignments.length === 0 ? (
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
      ) : (
        <div className="p-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-gray-500">
                  <th className="pb-2 font-medium w-6"></th>
                  <th className="pb-2 font-medium">作業名稱</th>
                  <th className="pb-2 font-medium">課文</th>
                  <th className="pb-2 font-medium">截止日期</th>
                  <th className="pb-2 font-medium text-center">完成率</th>
                  <th className="pb-2 font-medium text-center">狀態</th>
                  <th className="pb-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredAssignments.map((a) => {
                  const isExpanded = expandedId === a.id;
                  const displayTitle = a.title || a.story_title;
                  const completionPct =
                    a.submission_count > 0
                      ? Math.round((a.completed_count / a.submission_count) * 100)
                      : 0;
                  const isConfirmingDelete = confirmDeleteId === a.id;
                  const isDeleting = deletingId === a.id;
                  const isEditing = editingId === a.id;

                  return (
                    <React.Fragment key={a.id}>
                      <tr
                        className="cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => {
                          if (isConfirmingDelete || isEditing) return;
                          handleRowClick(a.id);
                        }}
                      >
                        <td className="py-2.5 text-gray-400">
                          <svg
                            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td className="py-2.5 text-gray-900 font-medium">{displayTitle}</td>
                        <td className="py-2.5 text-gray-600">{a.story_title}</td>
                        <td className="py-2.5 text-gray-600">
                          <span className={isOverdue(a.due_date) ? 'text-red-600' : ''}>
                            {formatDate(a.due_date)}
                          </span>
                          {isOverdue(a.due_date) && (
                            <span className="ml-1 inline-block px-1 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                              已逾期
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-center">
                          <span
                            className={`inline-block min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-medium ${
                              completionPct === 100
                                ? 'bg-green-100 text-green-700'
                                : completionPct > 0
                                  ? 'bg-accent-bg text-accent'
                                  : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {a.completed_count}/{a.submission_count}
                          </span>
                        </td>
                        <td className="py-2.5 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleActive(a);
                            }}
                            className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${
                              a.is_active
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                          >
                            {a.is_active ? '進行中' : '已停用'}
                          </button>
                        </td>
                        <td className="py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {isConfirmingDelete ? (
                            <div className="flex items-center gap-1 justify-center">
                              <button
                                onClick={() => handleDelete(a)}
                                disabled={isDeleting}
                                className="px-1.5 py-0.5 rounded bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-50 cursor-pointer transition-colors"
                              >
                                {isDeleting ? '...' : '確認'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-1.5 py-0.5 rounded border border-gray-300 text-gray-600 text-xs hover:bg-gray-50 cursor-pointer transition-colors"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5 justify-center">
                              <button
                                onClick={(e) => handleOpenEdit(a, e)}
                                className="p-1 rounded text-gray-400 hover:text-accent hover:bg-accent-bg transition-colors cursor-pointer"
                                title="編輯作業"
                                aria-label="編輯作業"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(a.id)}
                                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                                title="刪除作業"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>

                      {/* Inline edit form */}
                      {isEditing && (
                        <tr>
                          <td colSpan={7} className="bg-blue-50 px-4 py-3 border-b border-blue-100">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-800">編輯作業</span>
                              <button
                                onClick={handleCancelEdit}
                                className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer"
                              >
                                取消
                              </button>
                            </div>
                            {editError && (
                              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded px-3 py-2 mb-2">
                                {editError}
                              </div>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  作業標題
                                </label>
                                <input
                                  type="text"
                                  value={editTitle}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  placeholder="留空則使用課文標題"
                                  className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  說明
                                </label>
                                <input
                                  type="text"
                                  value={editDescription}
                                  onChange={(e) => setEditDescription(e.target.value)}
                                  placeholder="作業說明（選填）"
                                  className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                  截止日期
                                </label>
                                <input
                                  type="date"
                                  value={editDueDate}
                                  onChange={(e) => setEditDueDate(e.target.value)}
                                  className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-3">
                              <button
                                onClick={handleCancelEdit}
                                className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                              >
                                取消
                              </button>
                              <button
                                onClick={() => handleSaveEdit(a.id)}
                                disabled={isSavingEdit}
                                className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors cursor-pointer"
                              >
                                {isSavingEdit ? '儲存中...' : '儲存'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Expanded detail: grading panel */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-gray-50 px-4 py-3">
                            {/* Reading goals preview */}
                            <div className="mb-3">
                              <ReadingGoalsBadge
                                goals={{
                                  effectiveCpm: a.effective_cpm,
                                  effectiveAccuracy: a.effective_accuracy,
                                  difficultyLabel: a.difficulty_label,
                                  isCustom: a.target_cpm != null || a.target_accuracy != null,
                                }}
                                variant="compact"
                              />
                            </div>
                            {expandedDetail ? (
                              <AssignmentDetailPanel
                                assignmentId={a.id}
                                detail={expandedDetail}
                                isLoading={isLoadingDetail}
                                onGraded={handleGraded}
                              />
                            ) : isLoadingDetail ? (
                              <div className="flex items-center gap-2 py-4 justify-center">
                                <div className="w-4 h-4 border-2 border-gray-300 border-t-accent rounded-full animate-spin" />
                                <span className="text-xs text-gray-500">載入中...</span>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-500 py-4 text-center">無法載入作業詳情</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssignmentTab;

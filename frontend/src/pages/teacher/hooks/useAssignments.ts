import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { GoalsFormState } from '../../../components/teacher/ReadingGoalsForm';
import { useAuth } from '../../../contexts/AuthContext';
import {
  AssignmentApiError,
  AssignmentDetailResponse,
  AssignmentResponse,
  SubmissionResponse,
  createAssignment,
  deleteAssignment,
  getAssignmentDetail,
  getClassroomAssignments,
  updateAssignment,
} from '../../../services/assignmentApi';
import { fetchStories } from '../../../services/api';
import { Story } from '../../../types';
import { isPastDue } from '../../../utils/dueDate';

export type StatusFilter = 'all' | 'active' | 'inactive' | 'overdue';

export function useAssignments(classroomId: number, onChanged?: () => void) {
  const { token } = useAuth();

  const [assignments, setAssignments] = useState<AssignmentResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [allStories, setAllStories] = useState<Story[]>([]);
  const [isLoadingStories, setIsLoadingStories] = useState(false);
  const [storiesError, setStoriesError] = useState<string | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState('');
  // #3378: 派給誰 — null = whole class; extra classes get the same assignment (whole class)
  const [formStudentIds, setFormStudentIds] = useState<number[] | null>(null);
  const [formExtraClassIds, setFormExtraClassIds] = useState<number[]>([]);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDueDate, setFormDueDate] = useState('');
  const [formSkipCompleted, setFormSkipCompleted] = useState(false);
  const [formGoals, setFormGoals] = useState<GoalsFormState>({
    target_cpm: null,
    target_accuracy: null,
    difficulty_label: null,
  });
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AssignmentDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

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
    setStoriesError(null);
    try {
      const data = await fetchStories();
      setAllStories(data.stories);
    } catch (err) {
      setStoriesError(err instanceof Error ? err.message : '無法載入課文列表');
    } finally {
      setIsLoadingStories(false);
    }
  }, [allStories.length]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const storyMap = useMemo(() => {
    const map = new Map<string, Story>();
    allStories.forEach((story) => map.set(story.id, story));
    return map;
  }, [allStories]);

  const filteredAssignments = useMemo(() => {
    const now = new Date();
    return assignments.filter((assignment) => {
      switch (statusFilter) {
        case 'active':
          return assignment.is_active && !isPastDue(assignment.due_date, now);
        case 'inactive':
          return !assignment.is_active;
        case 'overdue':
          return assignment.is_active && isPastDue(assignment.due_date, now);
        default:
          return true;
      }
    });
  }, [assignments, statusFilter]);

  const tabCounts = useMemo(() => {
    const now = new Date();
    return {
      all: assignments.length,
      active: assignments.filter(
        (assignment) => assignment.is_active && !isPastDue(assignment.due_date, now),
      ).length,
      inactive: assignments.filter((assignment) => !assignment.is_active).length,
      overdue: assignments.filter(
        (assignment) => assignment.is_active && isPastDue(assignment.due_date, now),
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

  const retryLoadStories = () => {
    setStoriesError(null);
    setAllStories([]);
    loadStories();
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || !selectedStoryId) return;

    setIsCreating(true);
    setCreateError('');
    try {
      if (formStudentIds !== null && formStudentIds.length === 0) {
        setCreateError('請至少勾選一位學生，或改成全班');
        setIsCreating(false);
        return;
      }
      const base = {
        story_id: selectedStoryId,
        title: formTitle.trim() || undefined,
        description: formDescription.trim() || undefined,
        due_date: formDueDate || undefined,
        target_cpm: formGoals.target_cpm,
        target_accuracy: formGoals.target_accuracy,
        difficulty_label: formGoals.difficulty_label,
        skip_completed_steps: formSkipCompleted,
      };
      await createAssignment(token, classroomId, {
        ...base,
        ...(formStudentIds !== null ? { student_ids: formStudentIds } : {}),
      });
      // Same assignment to the teacher's other classes (均一's 任務代碼, without the code).
      const failed: number[] = [];
      for (const otherId of formExtraClassIds) {
        try {
          await createAssignment(token, otherId, base);
        } catch {
          failed.push(otherId);
        }
      }
      setFormStudentIds(null);
      setFormExtraClassIds([]);
      if (failed.length > 0) {
        setCreateError(`這個班已派好，但有 ${failed.length} 個其他班沒有派成功，請到該班再派一次`);
        await loadAssignments();
        onChanged?.();
        return;
      }
      setShowCreateForm(false);
      await loadAssignments();
      onChanged?.();
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
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      onChanged?.();
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
      setAssignments((prev) => prev.filter((item) => item.id !== assignment.id));
      if (expandedId === assignment.id) {
        setExpandedId(null);
        setExpandedDetail(null);
      }
      onChanged?.();
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

  const handleOpenEdit = (assignment: AssignmentResponse) => {
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
      setAssignments((prev) => prev.map((assignment) => (assignment.id === updated.id ? updated : assignment)));
      setEditingId(null);
      onChanged?.();
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

  const handleExpand = useCallback(
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

  const handleGraded = useCallback((updated: SubmissionResponse) => {
    setExpandedDetail((prev) => {
      if (!prev) return prev;
      const newSubs = prev.submissions.map((submission) =>
        submission.id === updated.id ? updated : submission,
      );
      const completedCount = newSubs.filter((submission) =>
        ['submitted', 'graded'].includes(submission.status),
      ).length;
      // submissions_by_student (StudentAttemptGroup[]) is what the desktop
      // grouped table actually renders from whenever useGrouped is true --
      // which is almost always, since every enrolled student gets a
      // submission row at assignment-creation time. This used to only be
      // populated on load/refetch, never patched after a grade or
      // mark-complete update, so the desktop view could keep showing a
      // stale status/score until the panel was collapsed and reopened.
      const newGroups = (prev.submissions_by_student ?? []).map((group) => {
        const attemptIdx = group.attempts.findIndex((a) => a.id === updated.id);
        if (attemptIdx === -1) return group;
        const newAttempts = group.attempts.map((a) =>
          a.id === updated.id
            ? {
                ...a,
                status: updated.status,
                submitted_at: updated.submitted_at,
                score: updated.score,
                teacher_feedback: updated.teacher_feedback,
                required_step_count: updated.required_step_count,
                completed_step_count: updated.completed_step_count,
                missing_step_ids: updated.missing_step_ids,
                marked_complete_by_teacher: updated.marked_complete_by_teacher,
              }
            : a,
        );
        // attempts is sorted desc by attempt_number (index 0 = latest), so
        // only keep latest_status/latest_score in sync when the updated
        // attempt actually IS the group's most recent one.
        return attemptIdx === 0
          ? { ...group, attempts: newAttempts, latest_status: updated.status, latest_score: updated.score }
          : { ...group, attempts: newAttempts };
      });
      return {
        ...prev,
        submissions: newSubs,
        submissions_by_student: newGroups,
        completed_count: completedCount,
      };
    });
    setAssignments((prev) =>
      prev.map((assignment) => {
        if (assignment.id !== expandedId) return assignment;
        const completedCount = assignment.completed_count;
        return { ...assignment, completed_count: completedCount };
      }),
    );
  }, [expandedId]);

  return {
    assignments,
    isLoading,
    error,
    setError,
    statusFilter,
    setStatusFilter,
    showCreateForm,
    setShowCreateForm,
    allStories,
    isLoadingStories,
    storiesError,
    selectedStoryId,
    setSelectedStoryId,
    formTitle,
    setFormTitle,
    formDescription,
    setFormDescription,
    formDueDate,
    setFormDueDate,
    formSkipCompleted,
    setFormSkipCompleted,
    formStudentIds,
    setFormStudentIds,
    formExtraClassIds,
    setFormExtraClassIds,
    formGoals,
    setFormGoals,
    isCreating,
    createError,
    expandedId,
    expandedDetail,
    isLoadingDetail,
    deletingId,
    confirmDeleteId,
    setConfirmDeleteId,
    editingId,
    editTitle,
    setEditTitle,
    editDescription,
    setEditDescription,
    editDueDate,
    setEditDueDate,
    isSavingEdit,
    editError,
    storyMap,
    filteredAssignments,
    tabCounts,
    loadAssignments,
    loadStories,
    retryLoadStories,
    handleOpenCreateForm,
    handleCreate,
    handleToggleActive,
    handleDelete,
    handleOpenEdit,
    handleCancelEdit,
    handleSaveEdit,
    handleExpand,
    handleGraded,
  };
}

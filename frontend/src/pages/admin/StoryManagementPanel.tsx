/**
 * StoryManagementPanel — Admin CRUD interface for platform stories.
 *
 * Orchestrator only — state management + API calls.
 * Sub-components handle rendering:
 *   - StoryListTable  → filter bar + sortable table
 *   - StoryFormModal  → create / edit form modal
 *   - ConfirmDialog   → delete confirmation (from shared admin components)
 *
 * Refactored in #1944 (original 576 LOC → slim orchestrator).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { PlusIcon } from '../../components/icons';
import AdminPageShell from '../../components/admin/AdminPageShell';
import ConfirmDialog from '../../components/admin/ConfirmDialog';
import StoryListTable from './StoryListTable';
import StoryFormModal from './StoryFormModal';
import {
  listAdminStories,
  createStory,
  updateStory,
  deleteStory,
  StoryAdminListItem,
  StoryUpdateRequest,
  AdminStoryApiError,
} from '../../services/adminStoryApi';
import {
  EMPTY_FORM,
  ModalMode,
  StoryFormState,
  formToCreateRequest,
  storyToFormState,
} from './storyFormMapper';

// ── Main Component ────────────────────────────────────────────────────────────

const StoryManagementPanel: React.FC = () => {
  const { token } = useAuth();

  // List state
  const [stories, setStories] = useState<StoryAdminListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<string>('');

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>('create');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<StoryAdminListItem | null>(null);
  const [formState, setFormState] = useState<StoryFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<StoryAdminListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // ── Load stories ───────────────────────────────────────────────────────────

  const loadStories = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError('');
    try {
      const data = await listAdminStories(token, {
        search: searchQuery || undefined,
        grade: gradeFilter ? parseInt(gradeFilter, 10) : undefined,
      });
      setStories(data.stories);
      setTotal(data.total);
    } catch (err) {
      setLoadError(err instanceof AdminStoryApiError ? err.message : '載入失敗');
    } finally {
      setIsLoading(false);
    }
  }, [token, searchQuery, gradeFilter]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  // ── Modal handlers ────────────────────────────────────────────────────────

  const openCreateModal = () => {
    setModalMode('create');
    setFormState(EMPTY_FORM);
    setFormError('');
    setShowModal(true);
  };

  const openEditModal = (story: StoryAdminListItem) => {
    setModalMode('edit');
    setEditTarget(story);
    setFormState(storyToFormState(story));
    setFormError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditTarget(null);
    setFormError('');
  };

  const handleFormChange = (
    field: keyof StoryFormState,
    value: string,
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setFormError('');

    const paragraphs = formState.paragraphs
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean);

    if (!formState.title.trim()) {
      setFormError('標題不能為空');
      return;
    }
    if (paragraphs.length === 0) {
      setFormError('至少需要一個段落');
      return;
    }
    if (modalMode === 'create' && !formState.lesson_number) {
      setFormError('課文編號不能為空');
      return;
    }

    setIsSubmitting(true);
    try {
      if (modalMode === 'create') {
        const req = formToCreateRequest(formState);
        await createStory(token, req);
      } else if (editTarget) {
        const updates: StoryUpdateRequest = {
          title: formState.title.trim(),
          grade: parseInt(formState.grade, 10),
          grade_code: formState.grade_code.trim(),
          genre: formState.genre,
          text_type: formState.text_type,
          reading_strategy: formState.reading_strategy.trim() || undefined,
          source_file: formState.source_file.trim() || undefined,
        };
        if (paragraphs.length > 0) {
          updates.paragraphs = paragraphs;
        }
        await updateStory(token, editTarget.lesson_number, updates);
      }
      closeModal();
      loadStories();
    } catch (err) {
      if (err instanceof AdminStoryApiError) {
        if (err.status === 409) {
          setFormError(`課文編號 ${formState.lesson_number} 已存在`);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('操作失敗，請稍後再試');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Delete handlers ───────────────────────────────────────────────────────

  const openDeleteConfirm = (story: StoryAdminListItem) => {
    setDeleteTarget(story);
    setDeleteError('');
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
    setDeleteError('');
  };

  const confirmDelete = async () => {
    if (!token || !deleteTarget) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteStory(token, deleteTarget.lesson_number);
      setDeleteTarget(null);
      loadStories();
    } catch (err) {
      setDeleteError(err instanceof AdminStoryApiError ? err.message : '刪除失敗');
    } finally {
      setIsDeleting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <AdminPageShell
        title="課文管理"
        subtitle={isLoading ? '載入中...' : `共 ${total} 篇課文`}
        isLoading={false}
        error=""
        isEmpty={false}
        emptyMessage="尚無課文"
        headerActions={(
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/90 transition-colors cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            新增課文
          </button>
        )}
      >
        <StoryListTable
          stories={stories}
          isLoading={isLoading}
          loadError={loadError}
          searchQuery={searchQuery}
          gradeFilter={gradeFilter}
          onSearchChange={setSearchQuery}
          onGradeChange={setGradeFilter}
          onRetry={loadStories}
          onEdit={openEditModal}
          onDelete={openDeleteConfirm}
        />
      </AdminPageShell>

      {/* Create / Edit Modal */}
      {showModal && (
        <StoryFormModal
          mode={modalMode}
          formState={formState}
          formError={formError}
          isSubmitting={isSubmitting}
          onFieldChange={handleFormChange}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="確認刪除"
        variant="destructive"
        message={deleteTarget && (
          <>
            確定要刪除課文「<strong>{deleteTarget.title}</strong>」（L{deleteTarget.lesson_number}）嗎？
            <br />
            <span className="text-gray-400 text-xs mt-1 block">課文將移至歸檔目錄，不會永久刪除。</span>
            {deleteError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
                {deleteError}
              </p>
            )}
          </>
        )}
        confirmLabel={isDeleting ? '刪除中...' : '確認刪除'}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
        isLoading={isDeleting}
      />
    </>
  );
};

export default StoryManagementPanel;

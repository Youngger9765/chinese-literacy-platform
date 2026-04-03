/**
 * StoryManagementPanel — Admin CRUD interface for platform stories.
 *
 * Features:
 * - Table listing all stories (lesson_number, title, grade, genre, paragraph_count)
 * - Search/filter by title and grade
 * - "新增課文" modal with form
 * - Edit button per row -> edit modal
 * - Delete button with confirmation dialog
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { PlusIcon } from '../../components/icons';
import {
  listAdminStories,
  createStory,
  updateStory,
  deleteStory,
  StoryAdminListItem,
  StoryCreateRequest,
  StoryUpdateRequest,
  AdminStoryApiError,
} from '../../services/adminStoryApi';

// ── Types ────────────────────────────────────────────────────────────────────

type ModalMode = 'create' | 'edit';

interface StoryFormState {
  lesson_number: string;
  title: string;
  grade: string;
  grade_code: string;
  genre: string;
  text_type: string;
  reading_strategy: string;
  paragraphs: string; // newline-separated
  source_file: string;
}

const EMPTY_FORM: StoryFormState = {
  lesson_number: '',
  title: '',
  grade: '4',
  grade_code: '',
  genre: '記敘文',
  text_type: '單',
  reading_strategy: '',
  paragraphs: '',
  source_file: '',
};

const GENRE_OPTIONS = ['記敘文', '說明文', '議論文', '文言文', '應用文'];
const TEXT_TYPE_OPTIONS = ['單', '多*2', '多*3'];

// ── Helper ───────────────────────────────────────────────────────────────────

function formToCreateRequest(form: StoryFormState): StoryCreateRequest {
  return {
    lesson_number: parseInt(form.lesson_number, 10),
    title: form.title.trim(),
    grade: parseInt(form.grade, 10),
    grade_code: form.grade_code.trim(),
    genre: form.genre,
    text_type: form.text_type,
    reading_strategy: form.reading_strategy.trim() || undefined,
    paragraphs: form.paragraphs
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean),
    source_file: form.source_file.trim() || undefined,
  };
}

function storyToFormState(story: StoryAdminListItem): StoryFormState {
  return {
    lesson_number: String(story.lesson_number),
    title: story.title,
    grade: String(story.grade),
    grade_code: story.grade_code,
    genre: story.genre,
    text_type: story.text_type,
    reading_strategy: story.reading_strategy ?? '',
    paragraphs: '',
    source_file: story.source_file ?? '',
  };
}

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
    <div className="p-6 sm:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">課文管理</h2>
            <p className="text-sm text-gray-500 mt-1">
              {isLoading ? '載入中...' : `共 ${total} 篇課文`}
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent/90 transition-colors cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            新增課文
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="搜尋課文標題..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
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

        {/* Error */}
        {loadError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {loadError}
            <button
              onClick={loadStories}
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

        {/* Table */}
        {!isLoading && !loadError && (
          <>
            {stories.length === 0 ? (
              <div className="rounded-2xl shadow-card px-4 py-12 text-center text-gray-400 text-sm bg-white">
                {searchQuery || gradeFilter ? '找不到符合條件的課文' : '尚無課文'}
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="md:hidden space-y-3">
                  {stories.map((story) => (
                    <div key={story.lesson_number} className="bg-white rounded-2xl shadow-card p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 text-sm">{story.title}</p>
                          <p className="text-xs text-gray-400 font-mono mt-0.5">L{story.lesson_number}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => openEditModal(story)}
                            className="text-accent hover:underline text-xs font-medium cursor-pointer"
                          >
                            編輯
                          </button>
                          <button
                            onClick={() => openDeleteConfirm(story)}
                            className="text-red-500 hover:underline text-xs font-medium cursor-pointer"
                          >
                            刪除
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        <div>
                          <span className="text-gray-400">年級</span>
                          <p className="text-gray-700">{story.grade_code}</p>
                        </div>
                        <div>
                          <span className="text-gray-400">文體</span>
                          <p className="text-gray-700">{story.genre}</p>
                        </div>
                        <div>
                          <span className="text-gray-400">段落</span>
                          <p className="text-gray-700">{story.paragraph_count}</p>
                        </div>
                        <div>
                          <span className="text-gray-400">字數</span>
                          <p className="text-gray-700">{story.char_count}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table view */}
                <div className="hidden md:block overflow-x-auto rounded-2xl shadow-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-16">
                          編號
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          標題
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">
                          年級
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">
                          文體
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">
                          段落數
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-20">
                          字數
                        </th>
                        <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {stories.map((story) => (
                        <tr key={story.lesson_number} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 font-mono text-gray-500">
                            {story.lesson_number}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {story.title}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {story.grade_code}
                          </td>
                          <td className="px-4 py-3 text-gray-600">
                            {story.genre}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {story.paragraph_count}
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {story.char_count}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => openEditModal(story)}
                              className="text-accent hover:underline text-xs font-medium cursor-pointer mr-3"
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => openDeleteConfirm(story)}
                              className="text-red-500 hover:underline text-xs font-medium cursor-pointer"
                            >
                              刪除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

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
      {deleteTarget && (
        <DeleteConfirmDialog
          story={deleteTarget}
          isDeleting={isDeleting}
          deleteError={deleteError}
          onConfirm={confirmDelete}
          onCancel={cancelDelete}
        />
      )}
    </div>
  );
};

// ── Story Form Modal ──────────────────────────────────────────────────────────

interface StoryFormModalProps {
  mode: ModalMode;
  formState: StoryFormState;
  formError: string;
  isSubmitting: boolean;
  onFieldChange: (field: keyof StoryFormState, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

const StoryFormModal: React.FC<StoryFormModalProps> = ({
  mode,
  formState,
  formError,
  isSubmitting,
  onFieldChange,
  onSubmit,
  onClose,
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">
            {mode === 'create' ? '新增課文' : '編輯課文'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="px-6 py-5 space-y-4">
          {/* Lesson number (read-only in edit mode) */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="課文編號">
              <input
                type="number"
                value={formState.lesson_number}
                onChange={(e) => onFieldChange('lesson_number', e.target.value)}
                disabled={mode === 'edit'}
                required
                min={1}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:bg-gray-100 disabled:text-gray-500"
                placeholder="例：58"
              />
            </Field>
            <Field label="年級 (4-9)">
              <select
                value={formState.grade}
                onChange={(e) => onFieldChange('grade', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 cursor-pointer"
              >
                {[4, 5, 6, 7, 8, 9].map((g) => (
                  <option key={g} value={String(g)}>{g} 年級</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="標題">
            <input
              type="text"
              value={formState.title}
              onChange={(e) => onFieldChange('title', e.target.value)}
              required
              maxLength={200}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              placeholder="例：第一百碗麵"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="年級代碼">
              <input
                type="text"
                value={formState.grade_code}
                onChange={(e) => onFieldChange('grade_code', e.target.value)}
                required
                maxLength={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="例：G5-10"
              />
            </Field>
            <Field label="文體">
              <select
                value={formState.genre}
                onChange={(e) => onFieldChange('genre', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 cursor-pointer"
              >
                {GENRE_OPTIONS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="文本類型">
              <select
                value={formState.text_type}
                onChange={(e) => onFieldChange('text_type', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 cursor-pointer"
              >
                {TEXT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="原始檔案名稱 (選填)">
              <input
                type="text"
                value={formState.source_file}
                onChange={(e) => onFieldChange('source_file', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                placeholder="例：G5-10-L58.docx"
              />
            </Field>
          </div>

          <Field label="閱讀策略 (選填)">
            <input
              type="text"
              value={formState.reading_strategy}
              onChange={(e) => onFieldChange('reading_strategy', e.target.value)}
              maxLength={200}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              placeholder="例：掌握段落大意"
            />
          </Field>

          <Field label={mode === 'edit' ? '段落內容 (每行一段，留空表示不更新)' : '段落內容 (每行一段，至少一段)'}>
            <textarea
              value={formState.paragraphs}
              onChange={(e) => onFieldChange('paragraphs', e.target.value)}
              rows={6}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
              placeholder={"第一段內容...\n第二段內容...\n第三段內容..."}
            />
          </Field>

          {/* Error */}
          {formError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {formError}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-accent hover:bg-accent/90 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? '儲存中...' : mode === 'create' ? '新增課文' : '儲存變更'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────

interface DeleteConfirmDialogProps {
  story: StoryAdminListItem;
  isDeleting: boolean;
  deleteError: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  story,
  isDeleting,
  deleteError,
  onConfirm,
  onCancel,
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
      <h3 className="text-lg font-bold text-gray-900">確認刪除</h3>
      <p className="text-sm text-gray-600">
        確定要刪除課文「<strong>{story.title}</strong>」（L{story.lesson_number}）嗎？
        <br />
        <span className="text-gray-400 text-xs mt-1 block">課文將移至歸檔目錄，不會永久刪除。</span>
      </p>
      {deleteError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {deleteError}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isDeleting}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isDeleting}
          className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer disabled:opacity-60"
        >
          {isDeleting ? '刪除中...' : '確認刪除'}
        </button>
      </div>
    </div>
  </div>
);

// ── Field helper ──────────────────────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
    {children}
  </div>
);

export default StoryManagementPanel;

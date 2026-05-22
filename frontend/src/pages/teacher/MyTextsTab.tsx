import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { createMyText, deleteMyText, getMyText, listMyTexts, TeacherTextsApiError, updateMyText } from '../../services/teacherTextsApi';
import type { TeacherTextDetail, TeacherTextItem } from '../../services/teacherTextsApi';
import DeleteTextDialog from './components/DeleteTextDialog';
import MyTextFormModal from './components/MyTextFormModal';
import MyTextPreviewModal from './components/MyTextPreviewModal';
import MyTextsList from './components/MyTextsList';
import { buildSavePayload, defaultForm, deleteResetState, emptyVocabItem, makeStableIds, mapDetailToForm } from './teacherTextFormMapper';
import type { FormState, VocabFormItem } from './teacherTextFormMapper';
const MyTextsTab: React.FC = () => {
  const { token } = useAuth();
  const [texts, setTexts] = useState<TeacherTextItem[]>([]), [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true), [listError, setListError] = useState('');
  const [searchQuery, setSearchQuery] = useState(''), [filterGrade, setFilterGrade] = useState<number | ''>(''), [filterGenre, setFilterGenre] = useState('');
  const [showForm, setShowForm] = useState(false), [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm()), [isSaving, setIsSaving] = useState(false), [formError, setFormError] = useState('');
  const [paragraphIds, setParagraphIds] = useState<string[]>(() => makeStableIds(1)), [vocabularyIds, setVocabularyIds] = useState<string[]>([]);
  const [previewText, setPreviewText] = useState<TeacherTextDetail | null>(null), [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null), [isDeleting, setIsDeleting] = useState(false);
  const loadTexts = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setListError('');
    try {
      const data = await listMyTexts(token, {
        search: searchQuery || undefined,
        grade: filterGrade !== '' ? filterGrade : undefined,
        genre: filterGenre || undefined,
      });
      setTexts(data.texts);
      setTotal(data.total);
    } catch (err) {
      setListError(err instanceof TeacherTextsApiError ? err.message : '無法載入課文列表');
    } finally {
      setIsLoading(false);
    }
  }, [token, searchQuery, filterGrade, filterGenre]);
  useEffect(() => { loadTexts(); }, [loadTexts]);
  function resetFormState() {
    setEditingId(null);
    setForm(defaultForm());
    setParagraphIds(makeStableIds(1));
    setVocabularyIds([]);
    setFormError('');
  }
  function openCreateForm() {
    resetFormState();
    setShowForm(true);
  }
  async function openEditForm(textId: number) {
    if (!token) return;
    setFormError('');
    try {
      const detail = await getMyText(token, textId);
      const nextForm = mapDetailToForm(detail);
      setEditingId(detail.id);
      setForm(nextForm);
      setParagraphIds(makeStableIds(nextForm.paragraphs.length));
      setVocabularyIds(makeStableIds(nextForm.vocabulary.length));
      setShowForm(true);
    } catch (err) {
      setListError(err instanceof TeacherTextsApiError ? err.message : '無法載入課文');
    }
  }
  function closeForm() {
    setShowForm(false);
    resetFormState();
  }
  function handleFormChange(field: keyof FormState, value: FormState[keyof FormState]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }
  function updateParagraph(index: number, value: string) {
    setForm((prev) => {
      const paragraphs = [...prev.paragraphs];
      paragraphs[index] = value;
      return { ...prev, paragraphs };
    });
  }
  function addParagraph() {
    setForm((prev) => ({ ...prev, paragraphs: [...prev.paragraphs, ''] }));
    setParagraphIds((prev) => [...prev, ...makeStableIds(1)]);
  }
  function removeParagraph(index: number) {
    setForm((prev) => (prev.paragraphs.length <= 1
      ? prev
      : { ...prev, paragraphs: prev.paragraphs.filter((_, i) => i !== index) }));
    setParagraphIds((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }
  function addVocabItem() {
    setForm((prev) => ({ ...prev, vocabulary: [...prev.vocabulary, emptyVocabItem()] }));
    setVocabularyIds((prev) => [...prev, ...makeStableIds(1)]);
  }
  function updateVocabItem(index: number, field: keyof VocabFormItem, value: string) {
    setForm((prev) => {
      const vocabulary = [...prev.vocabulary];
      vocabulary[index] = { ...vocabulary[index], [field]: value };
      return { ...prev, vocabulary };
    });
  }
  function removeVocabItem(index: number) {
    setForm((prev) => ({ ...prev, vocabulary: prev.vocabulary.filter((_, i) => i !== index) }));
    setVocabularyIds((prev) => prev.filter((_, i) => i !== index));
  }
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const payload = buildSavePayload(form);
    if (!payload.title) {
      setFormError('請輸入課文標題');
      return;
    }
    if (payload.paragraphs.length === 0) {
      setFormError('請至少輸入一段課文內容');
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      if (editingId !== null) await updateMyText(token, editingId, payload);
      else await createMyText(token, payload);
      closeForm();
      await loadTexts();
    } catch (err) {
      setFormError(err instanceof TeacherTextsApiError ? err.message : '儲存失敗，請再試一次');
    } finally {
      setIsSaving(false);
    }
  }
  async function handleDelete() {
    if (!token || confirmDeleteId === null) return;
    setIsDeleting(true);
    try {
      await deleteMyText(token, confirmDeleteId);
      setConfirmDeleteId(deleteResetState().confirmDeleteId);
      await loadTexts();
    } catch (err) {
      setListError(err instanceof TeacherTextsApiError ? err.message : '刪除失敗');
    } finally {
      setIsDeleting(false);
    }
  }
  async function openPreview(textId: number) {
    if (!token) return;
    setIsLoadingPreview(true);
    try {
      setPreviewText(await getMyText(token, textId));
    } catch {
      // silent
    } finally {
      setIsLoadingPreview(false);
    }
  }
  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">我的課文</h2>
          <p className="text-sm text-gray-500 mt-0.5">自建課文庫 — 建立後可在作業中指派給學生</p>
        </div>
        <button onClick={openCreateForm} className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新增課文
        </button>
      </div>
      <MyTextsList texts={texts} total={total} isLoading={isLoading} listError={listError} isLoadingPreview={isLoadingPreview} searchQuery={searchQuery} filterGrade={filterGrade} filterGenre={filterGenre} onSearchChange={setSearchQuery} onGradeChange={setFilterGrade} onGenreChange={setFilterGenre} onCreateClick={openCreateForm} onEditClick={openEditForm} onPreviewClick={openPreview} onDeleteClick={setConfirmDeleteId} />
      <MyTextFormModal open={showForm} editingId={editingId} form={form} paragraphIds={paragraphIds} vocabularyIds={vocabularyIds} isSaving={isSaving} formError={formError} onClose={closeForm} onSave={handleSave} onFormChange={handleFormChange} onUpdateParagraph={updateParagraph} onAddParagraph={addParagraph} onRemoveParagraph={removeParagraph} onAddVocab={addVocabItem} onUpdateVocab={updateVocabItem} onRemoveVocab={removeVocabItem} />
      <MyTextPreviewModal previewText={previewText} onClose={() => setPreviewText(null)} />
      <DeleteTextDialog open={confirmDeleteId !== null} isDeleting={isDeleting} onConfirm={handleDelete} onCancel={() => setConfirmDeleteId(null)} />
    </div>
  );
};
export default MyTextsTab;

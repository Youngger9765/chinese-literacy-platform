import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listMyTexts,
  createMyText,
  updateMyText,
  deleteMyText,
  getMyText,
  TeacherTextItem,
  TeacherTextDetail,
  TeacherTextCreateRequest,
  TeacherTextsApiError,
  VocabItem,
} from '../../services/teacherTextsApi';

const GENRES = ['記敘文', '說明文', '議論文', '文言文', '應用文'];
const GRADES = [4, 5, 6, 7, 8, 9];
const TEXT_TYPES = ['單', '多*2', '多*3'];

interface VocabFormItem {
  word: string;
  definition: string;
  note: string;
}

const emptyVocabItem = (): VocabFormItem => ({ word: '', definition: '', note: '' });

interface FormState {
  title: string;
  grade: number;
  genre: string;
  text_type: string;
  reading_strategy: string;
  paragraphs: string[];
  vocabulary: VocabFormItem[];
}

const defaultForm = (): FormState => ({
  title: '',
  grade: 5,
  genre: '記敘文',
  text_type: '單',
  reading_strategy: '',
  paragraphs: [''],
  vocabulary: [],
});

const MyTextsTab: React.FC = () => {
  const { token } = useAuth();

  // List state
  const [texts, setTexts] = useState<TeacherTextItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGrade, setFilterGrade] = useState<number | ''>('');
  const [filterGenre, setFilterGenre] = useState('');

  // Form/modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Preview state
  const [previewText, setPreviewText] = useState<TeacherTextDetail | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
      if (err instanceof TeacherTextsApiError) {
        setListError(err.message);
      } else {
        setListError('無法載入課文列表');
      }
    } finally {
      setIsLoading(false);
    }
  }, [token, searchQuery, filterGrade, filterGenre]);

  useEffect(() => {
    loadTexts();
  }, [loadTexts]);

  // ── Form helpers ──────────────────────────────────────────────────────────

  function openCreateForm() {
    setEditingId(null);
    setForm(defaultForm());
    setFormError('');
    setShowForm(true);
  }

  async function openEditForm(textId: number) {
    if (!token) return;
    setFormError('');
    try {
      const detail = await getMyText(token, textId);
      setEditingId(detail.id);
      setForm({
        title: detail.title,
        grade: detail.grade,
        genre: detail.genre,
        text_type: detail.text_type,
        reading_strategy: detail.reading_strategy ?? '',
        paragraphs: detail.paragraphs.length > 0 ? detail.paragraphs : [''],
        vocabulary: detail.vocabulary
          ? detail.vocabulary.map((v) => ({ word: v.word, definition: v.definition, note: v.note ?? '' }))
          : [],
      });
      setShowForm(true);
    } catch (err) {
      setListError(err instanceof TeacherTextsApiError ? err.message : '無法載入課文');
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(defaultForm());
    setFormError('');
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
  }

  function removeParagraph(index: number) {
    setForm((prev) => {
      if (prev.paragraphs.length <= 1) return prev;
      const paragraphs = prev.paragraphs.filter((_, i) => i !== index);
      return { ...prev, paragraphs };
    });
  }

  function addVocabItem() {
    setForm((prev) => ({ ...prev, vocabulary: [...prev.vocabulary, emptyVocabItem()] }));
  }

  function updateVocabItem(index: number, field: keyof VocabFormItem, value: string) {
    setForm((prev) => {
      const vocabulary = [...prev.vocabulary];
      vocabulary[index] = { ...vocabulary[index], [field]: value };
      return { ...prev, vocabulary };
    });
  }

  function removeVocabItem(index: number) {
    setForm((prev) => ({
      ...prev,
      vocabulary: prev.vocabulary.filter((_, i) => i !== index),
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    const validParagraphs = form.paragraphs.filter((p) => p.trim().length > 0);
    if (!form.title.trim()) {
      setFormError('請輸入課文標題');
      return;
    }
    if (validParagraphs.length === 0) {
      setFormError('請至少輸入一段課文內容');
      return;
    }

    const vocab: VocabItem[] | undefined =
      form.vocabulary.length > 0
        ? form.vocabulary
            .filter((v) => v.word.trim() && v.definition.trim())
            .map((v) => ({ word: v.word.trim(), definition: v.definition.trim(), note: v.note.trim() || undefined }))
        : undefined;

    const payload: TeacherTextCreateRequest = {
      title: form.title.trim(),
      grade: form.grade,
      genre: form.genre,
      text_type: form.text_type,
      reading_strategy: form.reading_strategy.trim() || undefined,
      paragraphs: validParagraphs,
      vocabulary: vocab,
    };

    setIsSaving(true);
    setFormError('');
    try {
      if (editingId !== null) {
        await updateMyText(token, editingId, payload);
      } else {
        await createMyText(token, payload);
      }
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
      setConfirmDeleteId(null);
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
      const detail = await getMyText(token, textId);
      setPreviewText(detail);
    } catch {
      // silent
    } finally {
      setIsLoadingPreview(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">我的課文</h2>
          <p className="text-sm text-gray-500 mt-0.5">自建課文庫 — 建立後可在作業中指派給學生</p>
        </div>
        <button
          onClick={openCreateForm}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新增課文
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="搜尋課文標題..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 w-48"
        />
        <select
          value={filterGrade}
          onChange={(e) => setFilterGrade(e.target.value === '' ? '' : Number(e.target.value))}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">所有年級</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>{g} 年級</option>
          ))}
        </select>
        <select
          value={filterGenre}
          onChange={(e) => setFilterGenre(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">所有體裁</option>
          {GENRES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {/* Error */}
      {listError && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {listError}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : texts.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
          <p className="text-sm">尚無自建課文</p>
          <button
            onClick={openCreateForm}
            className="mt-3 text-indigo-600 text-sm hover:underline"
          >
            建立第一篇課文
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400">共 {total} 篇課文</p>
          <div className="grid gap-3">
            {texts.map((text) => (
              <div
                key={text.id}
                className="flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:shadow-sm transition-shadow"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-800 truncate">{text.title}</span>
                    <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded-full shrink-0">
                      {text.grade} 年級
                    </span>
                    <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full shrink-0">
                      {text.genre}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${
                      text.status === 'published'
                        ? 'bg-green-50 text-green-700'
                        : 'bg-yellow-50 text-yellow-700'
                    }`}>
                      {text.status === 'published' ? '已發布' : '草稿'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {text.paragraph_count} 段 · {text.char_count} 字 ·
                    更新於 {new Date(text.updated_at).toLocaleDateString('zh-TW')}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <button
                    onClick={() => openPreview(text.id)}
                    className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    disabled={isLoadingPreview}
                  >
                    預覽
                  </button>
                  <button
                    onClick={() => openEditForm(text.id)}
                    className="px-3 py-1.5 text-xs text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    編輯
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(text.id)}
                    className="px-3 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    刪除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Create/Edit Modal ─────────────────────────────────────────── */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8"
          onKeyDown={(e) => { if (e.key === 'Escape') closeForm(); }}
          onClick={(e) => { if (e.target === e.currentTarget) closeForm(); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4" role="dialog" aria-modal="true" aria-label={editingId !== null ? '編輯課文' : '新增課文'}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">
                {editingId !== null ? '編輯課文' : '新增課文'}
              </h3>
              <button
                onClick={closeForm}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="關閉"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSave} className="px-6 py-5 space-y-5">
              {/* Basic info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    課文標題 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="請輸入課文標題"
                    autoFocus
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">年級</label>
                  <select
                    value={form.grade}
                    onChange={(e) => setForm((p) => ({ ...p, grade: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {GRADES.map((g) => (
                      <option key={g} value={g}>{g} 年級</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">體裁</label>
                  <select
                    value={form.genre}
                    onChange={(e) => setForm((p) => ({ ...p, genre: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {GENRES.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">文章類型</label>
                  <select
                    value={form.text_type}
                    onChange={(e) => setForm((p) => ({ ...p, text_type: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {TEXT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">閱讀策略</label>
                  <input
                    type="text"
                    value={form.reading_strategy}
                    onChange={(e) => setForm((p) => ({ ...p, reading_strategy: e.target.value }))}
                    placeholder="例：找主旨、推論、比較"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>

              {/* Paragraphs */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    課文段落 <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={addParagraph}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    + 新增段落
                  </button>
                </div>
                <div className="space-y-2">
                  {form.paragraphs.map((para, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <span className="text-xs text-gray-400 mt-2.5 w-5 shrink-0 text-right">
                        {idx + 1}
                      </span>
                      <textarea
                        value={para}
                        onChange={(e) => updateParagraph(idx, e.target.value)}
                        placeholder={`第 ${idx + 1} 段內容...`}
                        rows={3}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
                      />
                      {form.paragraphs.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeParagraph(idx)}
                          className="mt-1.5 text-gray-300 hover:text-red-400 transition-colors"
                          aria-label="刪除段落"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Vocabulary */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">生字詞彙（選填）</label>
                  <button
                    type="button"
                    onClick={addVocabItem}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    + 新增詞彙
                  </button>
                </div>
                {form.vocabulary.length > 0 && (
                  <div className="space-y-2">
                    {form.vocabulary.map((vocab, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <input
                          type="text"
                          value={vocab.word}
                          onChange={(e) => updateVocabItem(idx, 'word', e.target.value)}
                          placeholder="詞語"
                          className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <input
                          type="text"
                          value={vocab.definition}
                          onChange={(e) => updateVocabItem(idx, 'definition', e.target.value)}
                          placeholder="解釋"
                          className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <input
                          type="text"
                          value={vocab.note}
                          onChange={(e) => updateVocabItem(idx, 'note', e.target.value)}
                          placeholder="備註（可選）"
                          className="w-28 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <button
                          type="button"
                          onClick={() => removeVocabItem(idx)}
                          className="text-gray-300 hover:text-red-400 transition-colors"
                          aria-label="刪除詞彙"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Form error */}
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                  {formError}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors"
                >
                  {isSaving ? '儲存中...' : editingId !== null ? '更新課文' : '建立課文'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Preview Modal ─────────────────────────────────────────────── */}
      {previewText && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto py-8"
          onClick={() => setPreviewText(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h3 className="text-base font-semibold text-gray-800">{previewText.title}</h3>
              <button
                onClick={() => setPreviewText(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="關閉預覽"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex gap-2 flex-wrap">
                <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded-full">
                  {previewText.grade} 年級
                </span>
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                  {previewText.genre}
                </span>
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                  {previewText.char_count} 字
                </span>
              </div>

              <div className="space-y-3">
                {previewText.paragraphs.map((para, idx) => (
                  <p key={idx} className="text-sm text-gray-700 leading-relaxed">
                    {para}
                  </p>
                ))}
              </div>

              {previewText.vocabulary && previewText.vocabulary.length > 0 && (
                <div className="border-t border-gray-100 pt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">生字詞彙</h4>
                  <div className="space-y-1">
                    {previewText.vocabulary.map((v, idx) => (
                      <div key={idx} className="flex gap-3 text-sm">
                        <span className="font-medium text-gray-800 w-16 shrink-0">{v.word}</span>
                        <span className="text-gray-600">{v.definition}</span>
                        {v.note && <span className="text-gray-400 text-xs">({v.note})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ────────────────────────────────────────────── */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-2">確定要刪除這篇課文？</h3>
            <p className="text-sm text-gray-500 mb-5">刪除後無法復原。</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {isDeleting ? '刪除中...' : '確定刪除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyTextsTab;

import React, { useRef } from 'react';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import {
  FormState,
  GENRES,
  GRADES,
  TEXT_TYPES,
  VocabFormItem,
} from '../teacherTextFormMapper';

interface MyTextFormModalProps {
  open: boolean;
  editingId: number | null;
  form: FormState;
  paragraphIds: string[];
  vocabularyIds: string[];
  isSaving: boolean;
  formError: string;
  onClose: () => void;
  onSave: (e: React.FormEvent) => void;
  onFormChange: (field: keyof FormState, value: FormState[keyof FormState]) => void;
  onUpdateParagraph: (idx: number, value: string) => void;
  onAddParagraph: () => void;
  onRemoveParagraph: (idx: number) => void;
  onAddVocab: () => void;
  onUpdateVocab: (idx: number, field: keyof VocabFormItem, value: string) => void;
  onRemoveVocab: (idx: number) => void;
}

const MyTextFormModal: React.FC<MyTextFormModalProps> = ({
  open,
  editingId,
  form,
  paragraphIds,
  vocabularyIds,
  isSaving,
  formError,
  onClose,
  onSave,
  onFormChange,
  onUpdateParagraph,
  onAddParagraph,
  onRemoveParagraph,
  onAddVocab,
  onUpdateVocab,
  onRemoveVocab,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto py-8"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4"
        role="dialog"
        aria-modal="true"
        aria-label={editingId !== null ? '編輯課文' : '新增課文'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">
            {editingId !== null ? '編輯課文' : '新增課文'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="關閉">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={onSave} className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                課文標題 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => onFormChange('title', e.target.value)}
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
                onChange={(e) => onFormChange('grade', Number(e.target.value))}
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
                onChange={(e) => onFormChange('genre', e.target.value)}
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
                onChange={(e) => onFormChange('text_type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {TEXT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">閱讀策略</label>
              <input
                type="text"
                value={form.reading_strategy}
                onChange={(e) => onFormChange('reading_strategy', e.target.value)}
                placeholder="例：找主旨、推論、比較"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                課文段落 <span className="text-red-500">*</span>
              </label>
              <button type="button" onClick={onAddParagraph} className="text-xs text-indigo-600 hover:underline">
                + 新增段落
              </button>
            </div>
            <div className="space-y-2">
              {form.paragraphs.map((para, idx) => (
                <div key={paragraphIds[idx] ?? `p-${idx}`} className="flex gap-2 items-start">
                  <span className="text-xs text-gray-400 mt-2.5 w-5 shrink-0 text-right">{idx + 1}</span>
                  <textarea
                    value={para}
                    onChange={(e) => onUpdateParagraph(idx, e.target.value)}
                    placeholder={`第 ${idx + 1} 段內容...`}
                    rows={3}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
                  />
                  {form.paragraphs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveParagraph(idx)}
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

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">生字詞彙（選填）</label>
              <button type="button" onClick={onAddVocab} className="text-xs text-indigo-600 hover:underline">
                + 新增詞彙
              </button>
            </div>
            {form.vocabulary.length > 0 && (
              <div className="space-y-2">
                {form.vocabulary.map((vocab, idx) => (
                  <div key={vocabularyIds[idx] ?? `v-${idx}`} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={vocab.word}
                      onChange={(e) => onUpdateVocab(idx, 'word', e.target.value)}
                      placeholder="詞語"
                      className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <input
                      type="text"
                      value={vocab.definition}
                      onChange={(e) => onUpdateVocab(idx, 'definition', e.target.value)}
                      placeholder="解釋"
                      className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <input
                      type="text"
                      value={vocab.note}
                      onChange={(e) => onUpdateVocab(idx, 'note', e.target.value)}
                      placeholder="備註（可選）"
                      className="w-28 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <button
                      type="button"
                      onClick={() => onRemoveVocab(idx)}
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

          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
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
  );
};

export default MyTextFormModal;

/**
 * StoryFormModal — Create / Edit story metadata modal.
 *
 * Extracted from StoryManagementPanel as part of refactor #1944.
 */

import React from 'react';
import {
  GENRE_OPTIONS,
  ModalMode,
  StoryFormState,
  TEXT_TYPE_OPTIONS,
} from './storyFormMapper';

// ── Field helper ──────────────────────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
    {children}
  </div>
);

// ── Props ─────────────────────────────────────────────────────────────────────

export interface StoryFormModalProps {
  mode: ModalMode;
  formState: StoryFormState;
  formError: string;
  isSubmitting: boolean;
  onFieldChange: (field: keyof StoryFormState, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

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

export default StoryFormModal;

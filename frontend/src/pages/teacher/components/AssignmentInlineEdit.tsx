import React from 'react';
import { ZhTWDatePicker } from '../../../components/ui/ZhTWDatePicker';

export interface AssignmentInlineEditProps {
  editTitle: string;
  setEditTitle: (value: string) => void;
  editDescription: string;
  setEditDescription: (value: string) => void;
  editDueDate: string;
  setEditDueDate: (value: string) => void;
  editError: string;
  isSavingEdit: boolean;
  onCancel: () => void;
  onSave: () => void;
  variant?: 'mobile' | 'desktop';
}

export const AssignmentInlineEdit: React.FC<AssignmentInlineEditProps> = ({
  editTitle,
  setEditTitle,
  editDescription,
  setEditDescription,
  editDueDate,
  setEditDueDate,
  editError,
  isSavingEdit,
  onCancel,
  onSave,
  variant = 'desktop',
}) => {
  const fields = (
    <div className={variant === 'desktop' ? 'grid grid-cols-1 sm:grid-cols-3 gap-3' : 'space-y-3'}>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">作業標題</label>
        <input
          type="text"
          value={editTitle}
          onChange={(event) => setEditTitle(event.target.value)}
          placeholder="留空則使用課文標題"
          className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">說明</label>
        <input
          type="text"
          value={editDescription}
          onChange={(event) => setEditDescription(event.target.value)}
          placeholder="作業說明（選填）"
          className="w-full h-9 px-3 rounded-lg border border-gray-300 text-gray-900 bg-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">截止日期</label>
        <ZhTWDatePicker
          value={editDueDate}
          onChange={setEditDueDate}
        />
      </div>
    </div>
  );

  return (
    <div className={variant === 'mobile' ? 'mt-2 bg-blue-50 border border-blue-100 rounded-lg p-3' : ''}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-800">編輯作業</span>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 cursor-pointer">
          取消
        </button>
      </div>
      {editError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded px-3 py-2 mb-2">
          {editError}
        </div>
      )}
      {fields}
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50 transition-colors cursor-pointer"
        >
          取消
        </button>
        <button
          onClick={onSave}
          disabled={isSavingEdit}
          className="px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium transition-colors cursor-pointer"
        >
          {isSavingEdit ? '儲存中...' : '儲存'}
        </button>
      </div>
    </div>
  );
};

export default AssignmentInlineEdit;
